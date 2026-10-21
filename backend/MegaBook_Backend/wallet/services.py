"""Every money movement in MegaBook; the only code that creates LedgerEntry rows.

Views, the admin, other apps and commands call these functions and never touch
LedgerEntry directly. Every function follows the same pattern:

    with transaction.atomic():          # all or nothing
        lock the wallet rows            # SELECT ... FOR UPDATE, always ordered by id
        read balances                   # SUM in the database, AFTER the lock
        check the rules                 # WalletError with a Persian message
        create entries

Why the lock: without it, two withdrawals of 80 from a balance of 100 could both
read "100", both pass the check, and leave -60. With the lock the second one waits
until the first commits, then reads 20 and is refused. The balance must be read
after locking, never before.

Why always by id: a purchase locks several wallets (buyer, seller, MegaBook). If
one purchase locked A then B while another locked B then A, each would wait for
the other forever (a deadlock). Locking in one global order makes that impossible.

Lock order across the module: request row (if any) first, then wallet rows by id.
Checkout (orders/services.py) locks the buyer's user row before calling transfer;
no code locks a user row after a wallet row, so that can't form a cycle either.
"""
import uuid
from typing import NamedTuple

from django.db import IntegrityError, transaction
from django.db.models import BigIntegerField, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import GatewayPayment, LedgerEntry, TopUpRequest, Wallet, WithdrawalRequest
from .normalize import InvalidNumber, normalize_card_number

INSUFFICIENT_BALANCE = "موجودی کیف پول کافی نیست."
AMOUNT_NOT_POSITIVE = "مبلغ باید بیشتر از صفر باشد."
PENDING_WITHDRAWAL_EXISTS = "یک درخواست برداشت در انتظار پرداخت دارید. پس از بررسی آن، درخواست تازه ثبت کنید."
ALREADY_REVIEWED = "این درخواست قبلاً بررسی شده است."
REASON_REQUIRED = "دلیل رد را بنویسید."
DESCRIPTION_REQUIRED = "توضیح اصلاح را بنویسید."
ADJUSTMENT_ZERO = "مبلغ اصلاح نمی‌تواند صفر باشد."
ADMIN_REQUIRED = "فقط مدیر می‌تواند این کار را انجام دهد."


class WalletError(Exception):
    """A rule refused the operation. `message` is Persian and shown to the user;
    `field` names the input it belongs to, if any."""

    def __init__(self, message, field=None):
        super().__init__(message)
        self.message = message
        self.field = field


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def balance_of(wallet):
    """Sum of the wallet's entries, computed by the database (0 for a new wallet)."""
    return LedgerEntry.objects.filter(wallet=wallet).aggregate(
        total=Coalesce(Sum("amount"), Value(0), output_field=BigIntegerField())
    )["total"]


def wallet_of(user):
    return Wallet.objects.get(owner=user)


def platform_wallet():
    """MegaBook's own wallet. Created by a data migration; get_or_create keeps it
    working on a database emptied by tests. The unique constraint still allows one."""
    try:
        return Wallet.objects.get(kind=Wallet.Kind.PLATFORM)
    except Wallet.DoesNotExist:
        try:
            with transaction.atomic():
                return Wallet.objects.create(kind=Wallet.Kind.PLATFORM)
        except IntegrityError:
            return Wallet.objects.get(kind=Wallet.Kind.PLATFORM)


def ensure_user_wallet(user):
    """The user's wallet, created if missing. Called when a user is created (signals.py)."""
    wallet, _ = Wallet.objects.get_or_create(owner=user, defaults={"kind": Wallet.Kind.USER})
    return wallet


# ---------------------------------------------------------------------------
# Internal helpers (only this module uses them)
# ---------------------------------------------------------------------------

def _lock(*wallet_ids):
    """Lock wallet rows in id order and return them as {id: wallet}. Needs an open transaction."""
    wallets = Wallet.objects.select_for_update().filter(pk__in=set(wallet_ids)).order_by("pk")
    return {w.pk: w for w in wallets}


def _require_positive(amount, field="amount"):
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise WalletError(AMOUNT_NOT_POSITIVE, field)


def _require_admin(admin):
    if admin is None or not admin.is_staff:
        raise WalletError(ADMIN_REQUIRED)


def _check_can_change(wallet, change):
    """A user wallet may never go below zero. MegaBook's own wallet has no such rule."""
    if wallet.kind == Wallet.Kind.USER and balance_of(wallet) + change < 0:
        raise WalletError(INSUFFICIENT_BALANCE, "amount")


def _locked_request(model, request):
    """Re-read and lock the request row; refuse if it was already reviewed.

    Locking the request (not only the wallet) matters when two admins press
    "approve" at the same moment: the second waits, then sees it's no longer pending.
    """
    locked = model.objects.select_for_update().get(pk=request.pk)
    if locked.status != model.Status.PENDING:
        raise WalletError(ALREADY_REVIEWED)
    return locked


# ---------------------------------------------------------------------------
# Top-ups
# ---------------------------------------------------------------------------

def approve_topup(request, admin):
    """Credit the wallet with an approved card-to-card top-up, exactly once."""
    _require_admin(admin)
    with transaction.atomic():
        request = _locked_request(TopUpRequest, request)
        wallet_id = wallet_of(request.user).pk
        wallet = _lock(wallet_id)[wallet_id]
        request.status = TopUpRequest.Status.APPROVED
        request.reviewed_by = admin
        request.reviewed_at = timezone.now()
        request.save()
        # The unique constraint on topup_request is the last guard against a double credit
        return LedgerEntry.objects.create(
            wallet=wallet, amount=request.amount, type=LedgerEntry.Type.TOPUP, topup_request=request,
            description=f"کارت‌به‌کارت، شماره پیگیری {request.tracking_number}",
        )


def reject_topup(request, admin, reason):
    """Final rejection; the wallet is not touched."""
    _require_admin(admin)
    reason = (reason or "").strip()
    if not reason:
        raise WalletError(REASON_REQUIRED, "reason")
    with transaction.atomic():
        request = _locked_request(TopUpRequest, request)
        request.status = TopUpRequest.Status.REJECTED
        request.rejection_reason = reason
        request.reviewed_by = admin
        request.reviewed_at = timezone.now()
        request.save()
        return request


def credit_gateway_payment(payment):
    """Credit a gateway payment the gateway has VERIFIED as paid. Idempotent:
    calling it again for the same payment returns the existing entry.

    A real gateway's callback calls this after its own verify step; the frontend
    never gets to say "it was paid".
    """
    with transaction.atomic():
        payment = GatewayPayment.objects.select_for_update().get(pk=payment.pk)
        if payment.status == GatewayPayment.Status.PAID:
            return payment.entries.get()
        wallet_id = wallet_of(payment.user).pk
        wallet = _lock(wallet_id)[wallet_id]
        payment.status = GatewayPayment.Status.PAID
        payment.paid_at = timezone.now()
        payment.save()
        return LedgerEntry.objects.create(
            wallet=wallet, amount=payment.amount, type=LedgerEntry.Type.TOPUP, gateway_payment=payment,
            description="شارژ آنلاین",
        )


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------

def create_withdrawal(user, amount, card_number):
    """Create a withdrawal request and debit the wallet IMMEDIATELY.

    Debiting now (not on completion) means the money can't be spent on books while
    the admin is paying it out.
    """
    _require_positive(amount)
    try:
        card_number = normalize_card_number(card_number)
    except InvalidNumber as error:
        raise WalletError(str(error), "card_number")

    with transaction.atomic():
        wallet_id = wallet_of(user).pk
        wallet = _lock(wallet_id)[wallet_id]
        # With the wallet locked, two requests from the same user run one after
        # another, so the second one sees the first one's pending request.
        if WithdrawalRequest.objects.filter(user=user, status=WithdrawalRequest.Status.PENDING).exists():
            raise WalletError(PENDING_WITHDRAWAL_EXISTS)
        _check_can_change(wallet, -amount)
        try:
            # Savepoint: the one-pending unique constraint is the last guard
            with transaction.atomic():
                request = WithdrawalRequest.objects.create(user=user, amount=amount, card_number=card_number)
        except IntegrityError:
            raise WalletError(PENDING_WITHDRAWAL_EXISTS)
        LedgerEntry.objects.create(
            wallet=wallet, amount=-amount, type=LedgerEntry.Type.WITHDRAWAL, withdrawal_request=request,
            description=f"برداشت به کارت {request.masked_card}",
        )
        return request


def complete_withdrawal(request, admin, note=""):
    """The admin paid it out. Nothing is added to the ledger: the money left at creation."""
    _require_admin(admin)
    with transaction.atomic():
        request = _locked_request(WithdrawalRequest, request)
        request.status = WithdrawalRequest.Status.COMPLETED
        request.admin_note = note
        request.reviewed_by = admin
        request.reviewed_at = timezone.now()
        request.save()
        return request


def reject_withdrawal(request, admin, note):
    """Final rejection; a reversal entry gives the money back."""
    _require_admin(admin)
    note = (note or "").strip()
    if not note:
        raise WalletError(REASON_REQUIRED, "reason")
    with transaction.atomic():
        request = _locked_request(WithdrawalRequest, request)
        wallet_id = wallet_of(request.user).pk
        wallet = _lock(wallet_id)[wallet_id]
        request.status = WithdrawalRequest.Status.REJECTED
        request.admin_note = note
        request.reviewed_by = admin
        request.reviewed_at = timezone.now()
        request.save()
        LedgerEntry.objects.create(
            wallet=wallet, amount=request.amount, type=LedgerEntry.Type.WITHDRAWAL_REVERSAL,
            withdrawal_request=request, description="برگشت مبلغ درخواست برداشت ردشده",
        )
        return request


# ---------------------------------------------------------------------------
# Manual adjustment
# ---------------------------------------------------------------------------

def adjust(wallet, amount, description, admin):
    """An admin's manual correction, positive or negative, with a required description.

    The only way to fix a mistake: entries are never edited or deleted. A negative
    adjustment can't take a user wallet below zero either.
    """
    _require_admin(admin)
    if not isinstance(amount, int) or isinstance(amount, bool) or amount == 0:
        raise WalletError(ADJUSTMENT_ZERO, "amount")
    description = (description or "").strip()
    if not description:
        raise WalletError(DESCRIPTION_REQUIRED, "description")
    with transaction.atomic():
        wallet = _lock(wallet.pk)[wallet.pk]
        _check_can_change(wallet, amount)
        return LedgerEntry.objects.create(
            wallet=wallet, amount=amount, type=LedgerEntry.Type.ADJUSTMENT, description=description,
            created_by=admin,
        )


# ---------------------------------------------------------------------------
# Multi-wallet transfer (for checkout)
# ---------------------------------------------------------------------------

class Leg(NamedTuple):
    """One line of a transfer. The optional fields are copied onto the entry."""

    wallet: Wallet
    amount: int
    type: str
    description: str = ""
    order: object = None
    order_item: object = None


def transfer(legs, description=""):
    """Move money between wallets as one unit; the legs must sum to zero.

    legs: Leg(...) or plain (wallet, amount, type) tuples, with type in
    LedgerEntry.TRANSFER_TYPES. Double-entry style: money is never created or
    destroyed by a transfer, only moved, so the legs of one transfer always sum to
    zero. All legs share a group id. `description` is used for legs without their own.
    If any user wallet would go below zero, nothing is written.
    Returns the created entries.
    """
    legs = [Leg(*leg) for leg in legs]
    legs = [leg for leg in legs if leg.amount != 0]
    if len(legs) < 2:
        raise ValueError("A transfer needs at least two non-zero legs.")
    if sum(leg.amount for leg in legs) != 0:
        raise ValueError("Transfer legs must sum to zero.")
    for leg in legs:
        if leg.type not in LedgerEntry.TRANSFER_TYPES:
            raise ValueError(f"{leg.type} is not a transfer type.")
        if isinstance(leg.amount, bool) or not isinstance(leg.amount, int):
            raise ValueError("Amounts are integer toman.")

    with transaction.atomic():
        locked = _lock(*(leg.wallet.pk for leg in legs))
        # Net change per wallet: the same wallet may appear in several legs
        # (e.g. one seller with two books in the same order)
        net = {}
        for leg in legs:
            net[leg.wallet.pk] = net.get(leg.wallet.pk, 0) + leg.amount
        for wallet_id, change in net.items():
            _check_can_change(locked[wallet_id], change)

        group = uuid.uuid4()
        return [
            LedgerEntry.objects.create(
                wallet=locked[leg.wallet.pk], amount=leg.amount, type=leg.type, group=group,
                description=(leg.description or description)[:255], order=leg.order, order_item=leg.order_item,
            )
            for leg in legs
        ]


def purchase_legs(buyer_wallet, order, items, buyer_description=""):
    """The legs of paying for one order (DECISIONS 10.5):

    - ONE debit for the buyer: the order's total, linked to the order;
    - per book: the uploader's seller_share and MegaBook's commission
      (price - seller_share, DECISIONS 3.11), linked to that book's order item.

    Amounts come from the order items (the snapshot taken at checkout), never from
    the request. Zero legs are left out: a free book has none, an admin's book has no
    seller leg, a book whose price equals the share has no commission leg.
    """
    platform = platform_wallet()
    legs = [Leg(buyer_wallet, -sum(item.price for item in items), LedgerEntry.Type.PURCHASE,
                buyer_description, order=order)]
    for item in items:
        title = item.book.title
        legs.append(Leg(wallet_of(item.book.uploaded_by), item.seller_share, LedgerEntry.Type.SALE_INCOME,
                        f"فروش «{title}»", order_item=item))
        legs.append(Leg(platform, item.commission, LedgerEntry.Type.COMMISSION,
                        f"کمیسیون «{title}»", order_item=item))
    return [leg for leg in legs if leg.amount != 0]
