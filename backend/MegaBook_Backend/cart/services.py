"""Cart rules, separate from HTTP (like book_requests/services.py).

Prices always come from the database: the frontend sends only book ids.
"""
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from catalog.models import Book
from catalog.ownership import owned_book_ids
from wallet import services as wallet_services

from .models import CartItem

MAX_ITEMS = 50

# Machine-readable reasons the frontend can branch on, with the Persian message
NOT_AVAILABLE = "not_available"
OWN_UPLOAD = "own_upload"
ALREADY_OWNED = "already_owned"
CART_FULL = "cart_full"

MESSAGES = {
    NOT_AVAILABLE: "این کتاب در فروشگاه موجود نیست.",
    OWN_UPLOAD: "این کتاب را خودتان بارگذاری کرده‌اید و برای خواندنش نیازی به خرید ندارید.",
    ALREADY_OWNED: "این کتاب را دارید و در کتابخانهٔ شماست.",
    CART_FULL: "سبد خرید حداکثر ۵۰ کتاب جا دارد. برای افزودن کتاب تازه، یکی را از سبد حذف کنید.",
}

# Item statuses in the cart response
OK = "ok"
PRICE_CHANGED = "price_changed"
UNAVAILABLE = "unavailable"


class CartError(Exception):
    def __init__(self, code):
        super().__init__(MESSAGES[code])
        self.code = code
        self.message = MESSAGES[code]


def add(user, book_id):
    """Add a book to the user's cart. Returns True if added, False if it was already there.

    Already in the cart is not an error (idempotent), so a double-click is harmless.
    """
    with transaction.atomic():
        # Lock the user's row: their cart operations run one after another, so two
        # adds at 49 items can't both pass the size check and leave 51. The same
        # NO KEY UPDATE lock as checkout (orders.services._lock_buyer explains why)
        get_user_model().objects.select_for_update(no_key=True).filter(pk=user.pk).first()

        book = Book.objects.filter(pk=book_id).first()
        # A missing book and an unapproved one get the same answer, so the response
        # doesn't reveal which ids exist
        if book is None or book.status != Book.Status.APPROVED:
            raise CartError(NOT_AVAILABLE)
        if book.uploaded_by_id == user.pk:
            raise CartError(OWN_UPLOAD)
        if owned_book_ids(user, [book.pk]):
            raise CartError(ALREADY_OWNED)

        if CartItem.objects.filter(user=user, book=book).exists():
            return False
        if CartItem.objects.filter(user=user).count() >= MAX_ITEMS:
            raise CartError(CART_FULL)
        try:
            with transaction.atomic():
                CartItem.objects.create(user=user, book=book, price_seen=book.price)
        except IntegrityError:
            return False  # added by a parallel request a moment ago
        return True


def remove(user, book_id):
    """Remove a book from the cart. Removing something that isn't there is not an error."""
    CartItem.objects.filter(user=user, book_id=book_id).delete()


def clear(user):
    """Empty the cart (checkout calls this after a successful purchase)."""
    CartItem.objects.filter(user=user).delete()


def acknowledge_prices(user, book_id=None):
    """The user saw the new price: copy the current price into price_seen.

    For one book, or all `price_changed` items when book_id is None.
    """
    items = CartItem.objects.filter(user=user, book__status=Book.Status.APPROVED).select_related("book")
    if book_id is not None:
        items = items.filter(book_id=book_id)
    for item in items:
        if item.book.price is not None and item.price_seen != item.book.price:
            item.price_seen = item.book.price
            item.save(update_fields=["price_seen"])


def status_of(item):
    book = item.book
    if book.status != Book.Status.APPROVED or book.price is None:
        return UNAVAILABLE
    if book.price != item.price_seen:
        return PRICE_CHANGED
    return OK


def get_cart(user):
    """The cart, checked against the current database state.

    Books the user now owns (e.g. bought elsewhere) are removed, and reported in
    `removed` so the page can say so. Every item gets a status (status_of).
    total: current prices of the items that can be bought (not `unavailable`).
    """
    items = list(
        CartItem.objects.filter(user=user).select_related("book").prefetch_related("book__authors")
    )

    owned = owned_book_ids(user, [item.book_id for item in items])
    removed = [{"book_id": item.book_id, "title": item.book.title} for item in items if item.book_id in owned]
    if owned:
        CartItem.objects.filter(user=user, book_id__in=owned).delete()
        items = [item for item in items if item.book_id not in owned]

    for item in items:
        item.status = status_of(item)
    total = sum(item.book.price for item in items if item.status != UNAVAILABLE)

    return {
        "items": items,
        "removed": removed,
        "count": len(items),
        "total": total,
        "balance": wallet_services.balance_of(wallet_services.wallet_of(user)),
    }
