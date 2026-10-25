"""Checkout: turn the user's cart into an order, library items and ledger entries.

Everything happens in ONE database transaction, so a purchase is all or nothing:
if any step fails (a changed price, not enough money, a constraint), nothing is
saved: no order, no library items, no money moved, and the cart stays as it was.

Prices always come from the database. The request carries no prices and no book
list: we buy exactly what is in the user's server-side cart.

Lock order: the buyer's user row, then their cart rows, then (inside
wallet.services.transfer) wallet rows by id. See _lock_buyer for why the user row
and not the buyer's wallet.
"""
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from cart import services as cart_services
from cart.models import CartItem
from catalog.ownership import owned_book_ids
from library.models import LibraryItem
from notifications import services as notifications
from wallet import services as wallet_services

from .models import Order, OrderItem

# Machine-readable reasons the frontend can branch on
EMPTY_CART = "empty_cart"
CART_CHANGED = "cart_changed"
ALREADY_OWNED = "already_owned"
INSUFFICIENT_BALANCE = "insufficient_balance"

MESSAGES = {
    EMPTY_CART: "سبد خرید شما خالی است.",
    CART_CHANGED: "سبد خرید شما تغییر کرده است. کتاب‌های علامت‌خورده را بررسی کنید و دوباره پرداخت کنید.",
    ALREADY_OWNED: "یکی از کتاب‌های سبد را از قبل دارید. سبد را دوباره بررسی کنید.",
}


class CheckoutError(Exception):
    def __init__(self, code, message=None, shortfall=None):
        self.code = code
        self.message = message or MESSAGES[code]
        self.shortfall = shortfall
        super().__init__(self.message)


def _lock_buyer(user):
    """Lock the buyer's user row: two checkouts by the same user run one after another.

    Why not the buyer's WALLET row, which would also serialize them? Wallets must be
    locked in id order (wallet/services.py). Locking the buyer's wallet first breaks
    that order: if Ali (wallet 5) buys Sara's book while Sara (wallet 3) buys Ali's,
    one checkout holds 5 and waits for 3, the other holds 3 and waits for 5: a
    deadlock. The user row is a different table that no code locks after a wallet,
    so it can't form a cycle. cart.services.add takes the same lock, so adding to
    the cart during a checkout simply waits.

    FOR NO KEY UPDATE, not plain FOR UPDATE: inserting a row with a foreign key to a
    user (a notification for the seller) takes a KEY SHARE lock on that user, which
    FOR UPDATE blocks and NO KEY UPDATE doesn't. With FOR UPDATE, Ali and Sara buying
    each other's books would each wait to notify the other: a deadlock. Two NO KEY
    UPDATE locks still exclude each other, so checkouts by one user still run in turn.
    """
    get_user_model().objects.select_for_update(no_key=True).filter(pk=user.pk).first()


def _buyer_description(items):
    """The buyer's wallet history line, e.g. «خرید ۲ کتاب: «الف»، «ب»»."""
    count = f"{len(items):,}".translate(str.maketrans("0123456789,", "۰۱۲۳۴۵۶۷۸۹٬"))
    titles = "، ".join(f"«{item.book.title}»" for item in items)
    text = f"خرید {count} کتاب: {titles}"
    return text if len(text) <= 255 else text[:254] + "…"


def checkout(user):
    """Buy everything in the user's cart. Returns the Order (items prefetched).

    Raises CheckoutError; the transaction is rolled back before the caller sees it.
    """
    with transaction.atomic():
        # 1. Serialize this user's checkouts. Everything below reads the database
        #    AFTER the lock, so a second, parallel checkout (a double click) sees the
        #    cart the first one already emptied and is refused as empty.
        _lock_buyer(user)

        # 2. The cart, locked too: removing a book or accepting a price in another
        #    tab waits until we're done. `of=("self",)` locks only the cart rows,
        #    not the joined books (other buyers of the same book don't wait).
        cart_items = list(
            CartItem.objects.select_for_update(of=("self",)).filter(user=user).select_related("book", "book__uploaded_by")
        )
        if not cart_items:
            raise CheckoutError(EMPTY_CART)

        # 3. The user must have seen and accepted every price, and every book must
        #    be on sale. Otherwise refuse; the caller returns the current cart.
        if any(cart_services.status_of(item) != cart_services.OK for item in cart_items):
            raise CheckoutError(CART_CHANGED)

        # 4. Re-check what the cart rules checked when adding (things may have changed)
        books = [item.book for item in cart_items]
        if any(book.uploaded_by_id == user.pk for book in books):
            raise CheckoutError(CART_CHANGED)
        if owned_book_ids(user, [book.pk for book in books]):
            raise CheckoutError(ALREADY_OWNED)

        # 5. The receipt and the library, with the price and share of THIS moment
        order = Order.objects.create(buyer=user)
        items = [
            OrderItem.objects.create(order=order, book=book, price=book.price, seller_share=book.seller_share)
            for book in books
        ]
        try:
            # Savepoint: the unique (user, book) constraint is the last guard against
            # getting a book twice; turn its error into a clear answer
            with transaction.atomic():
                for item in items:
                    LibraryItem.objects.create(user=user, book=item.book, order_item=item)
        except IntegrityError:
            raise CheckoutError(ALREADY_OWNED)

        # 6. The money. Nothing to move when everything is free (the ledger has no
        #    zero entries), but the order and library items are still created.
        total = sum(item.price for item in items)
        if total:
            buyer_wallet = wallet_services.wallet_of(user)
            legs = wallet_services.purchase_legs(buyer_wallet, order, items, _buyer_description(items))
            try:
                wallet_services.transfer(legs)
            except wallet_services.WalletError:
                # transfer is the one that checks the balance, under its wallet locks.
                # Its savepoint is rolled back (releasing those locks), so this read is
                # only for the message; the refusal itself was decided under the lock.
                shortfall = total - wallet_services.balance_of(buyer_wallet)
                raise CheckoutError(
                    INSUFFICIENT_BALANCE,
                    f"موجودی کیف پول کافی نیست؛ برای این خرید {_toman(shortfall)} کم دارید.",
                    shortfall=shortfall,
                )

        # 7. The uploaders whose share reached their wallet: exactly the non-zero
        #    sale_income legs above. A free book or an admin's book moves no money to
        #    anyone, so it notifies no one (DECISIONS 14).
        for item in items:
            if item.seller_share:
                notifications.notify(
                    notifications.Type.SALE_INCOME, [item.book.uploaded_by], order_item=item, book=item.book,
                    params={"title": item.book.title, "amount": item.seller_share},
                )

        # 8. Bought: the cart is empty now
        cart_services.clear(user)

    return Order.objects.prefetch_related("items__book").get(pk=order.pk)


def _toman(amount):
    return f"{amount:,} تومان".translate(str.maketrans("0123456789,", "۰۱۲۳۴۵۶۷۸۹٬"))
