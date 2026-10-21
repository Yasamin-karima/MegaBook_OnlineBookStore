"""The wallet: a ledger of immutable entries (DECISIONS 6).

There is no balance column anywhere. A wallet's balance is the sum of its entries,
computed in the database (services.balance_of). A wallet balance is MegaBook's debt
to that user; the real money sits in MegaBook's bank account.

Only wallet/services.py creates LedgerEntry rows. Everything else (views, admin,
other apps, commands) calls a service function.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from MegaBook_Backend.private_files import RandomName, private_storage

from .normalize import InvalidNumber, group_card_number, mask_card_number, normalize_card_number, normalize_tracking_number

REJECTION_REASON_REQUIRED = "برای رد کردن درخواست، دلیل رد را بنویسید."
DEPOSIT_IN_FUTURE = "زمان واریز نمی‌تواند در آینده باشد."
TRACKING_TAKEN = "این شماره پیگیری قبلاً ثبت شده است."


class Wallet(models.Model):
    """One per user, plus exactly one platform wallet for MegaBook itself.

    MegaBook is not a fake user: a user can log in, has a password, shows up in the
    user list and could be made staff or deleted by mistake. The platform wallet is
    a ledger concept, not a person. MegaBook's commission is credited here.

    The wallet row is what services lock (SELECT ... FOR UPDATE) during money
    operations, so operations on the same wallet run one after another.
    """

    class Kind(models.TextChoices):
        USER = "user", "کاربر"
        PLATFORM = "platform", "مگابوک"

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.USER)
    # OneToOne: one wallet per user, enforced by the database. CASCADE: a user with
    # no entries can still be deleted; LedgerEntry.wallet is PROTECT, so a user who
    # ever had money movement can't be (DECISIONS 3.9).
    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="wallet"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # A user wallet has an owner; the platform wallet has none
            models.CheckConstraint(
                condition=(Q(kind="user") & Q(owner__isnull=False)) | (Q(kind="platform") & Q(owner__isnull=True)),
                name="wallet_owner_matches_kind",
            ),
            # Only one platform wallet (a partial unique index in PostgreSQL)
            models.UniqueConstraint(fields=["kind"], condition=Q(kind="platform"), name="single_platform_wallet"),
        ]

    def __str__(self):
        return "کیف پول مگابوک" if self.kind == self.Kind.PLATFORM else f"کیف پول {self.owner}"


class LedgerEntryQuerySet(models.QuerySet):
    # Bulk changes skip Model.save()/delete(), so they are blocked here too
    def update(self, **kwargs):
        raise ImmutableLedgerError("Ledger entries can't be updated; add a compensating entry instead.")

    def delete(self):
        raise ImmutableLedgerError("Ledger entries can't be deleted; add a compensating entry instead.")


class ImmutableLedgerError(Exception):
    """Raised on any attempt to change or remove a ledger entry."""


class LedgerEntry(models.Model):
    """One immutable money movement. Positive amount = money in, negative = money out.

    Mistakes are fixed with a compensating entry (an adjustment, or a reversal),
    never by editing or deleting an entry, so the history always shows what happened.
    """

    class Type(models.TextChoices):
        TOPUP = "topup", "شارژ"
        PURCHASE = "purchase", "خرید کتاب"
        SALE_INCOME = "sale_income", "سهم فروش"
        COMMISSION = "commission", "کمیسیون"
        WITHDRAWAL = "withdrawal", "برداشت"
        WITHDRAWAL_REVERSAL = "withdrawal_reversal", "برگشت برداشت"
        ADJUSTMENT = "adjustment", "اصلاح دستی"

    # Which sign each type must have (adjustment may be either)
    CREDIT_TYPES = [Type.TOPUP, Type.SALE_INCOME, Type.COMMISSION, Type.WITHDRAWAL_REVERSAL]
    DEBIT_TYPES = [Type.PURCHASE, Type.WITHDRAWAL]
    # The legs of a multi-wallet transfer (services.transfer); they share a group
    TRANSFER_TYPES = [Type.PURCHASE, Type.SALE_INCOME, Type.COMMISSION]

    wallet = models.ForeignKey(Wallet, on_delete=models.PROTECT, related_name="entries")
    # BigInteger: toman amounts and sums can outgrow a 32-bit integer (~2.1 billion)
    amount = models.BigIntegerField()
    type = models.CharField(max_length=20, choices=Type.choices)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # The admin who made a manual adjustment
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    # --- What caused the entry (at most one, matching the type; see constraints) ---
    topup_request = models.ForeignKey(
        "TopUpRequest", on_delete=models.PROTECT, null=True, blank=True, related_name="entries"
    )
    withdrawal_request = models.ForeignKey(
        "WithdrawalRequest", on_delete=models.PROTECT, null=True, blank=True, related_name="entries"
    )
    gateway_payment = models.ForeignKey(
        "GatewayPayment", on_delete=models.PROTECT, null=True, blank=True, related_name="entries"
    )
    # Ties together the legs of one transfer (e.g. one purchase: buyer, seller, MegaBook)
    group = models.UUIDField(null=True, blank=True, db_index=True)
    # What a purchase entry belongs to: the buyer's one debit links to the order, each
    # book's seller income and commission link to that book's line (DECISIONS 10.5)
    order = models.ForeignKey(
        "orders.Order", on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries"
    )
    order_item = models.ForeignKey(
        "orders.OrderItem", on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entries"
    )

    objects = LedgerEntryQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name_plural = "ledger entries"
        indexes = [models.Index(fields=["wallet", "-created_at"], name="ledger_wallet_created_idx")]
        constraints = [
            models.CheckConstraint(condition=~Q(amount=0), name="ledger_amount_not_zero"),
            models.CheckConstraint(
                condition=(
                    (Q(type__in=["topup", "sale_income", "commission", "withdrawal_reversal"]) & Q(amount__gt=0))
                    | (Q(type__in=["purchase", "withdrawal"]) & Q(amount__lt=0))
                    | Q(type="adjustment")
                ),
                name="ledger_amount_sign_matches_type",
            ),
            # A top-up comes from exactly one source: a card-to-card request or a gateway payment
            models.CheckConstraint(
                condition=~Q(type="topup") | (
                    (Q(topup_request__isnull=False) & Q(gateway_payment__isnull=True))
                    | (Q(topup_request__isnull=True) & Q(gateway_payment__isnull=False))
                ),
                name="ledger_topup_has_one_source",
            ),
            models.CheckConstraint(
                condition=~Q(type__in=["withdrawal", "withdrawal_reversal"]) | Q(withdrawal_request__isnull=False),
                name="ledger_withdrawal_has_request",
            ),
            models.CheckConstraint(
                condition=~Q(type__in=["purchase", "sale_income", "commission"]) | Q(group__isnull=False),
                name="ledger_transfer_has_group",
            ),
            models.CheckConstraint(
                condition=~Q(type="adjustment") | (Q(created_by__isnull=False) & ~Q(description="")),
                name="ledger_adjustment_has_admin_and_description",
            ),
            # Links only on the types they belong to
            models.CheckConstraint(
                condition=(Q(topup_request__isnull=True) & Q(gateway_payment__isnull=True)) | Q(type="topup"),
                name="ledger_topup_links_only_on_topup",
            ),
            models.CheckConstraint(
                condition=Q(withdrawal_request__isnull=True) | Q(type__in=["withdrawal", "withdrawal_reversal"]),
                name="ledger_withdrawal_link_only_on_withdrawal",
            ),
            # A purchase debit belongs to an order; seller income and commission belong
            # to one order line; no other type links to orders
            models.CheckConstraint(
                condition=(Q(type="purchase") & Q(order__isnull=False) & Q(order_item__isnull=True))
                | (Q(type__in=["sale_income", "commission"]) & Q(order__isnull=True) & Q(order_item__isnull=False))
                | (~Q(type__in=["purchase", "sale_income", "commission"]) & Q(order__isnull=True) & Q(order_item__isnull=True)),
                name="ledger_purchase_links_match_type",
            ),
            # Exactly-once, in the database itself: a top-up request or a gateway payment
            # can credit a wallet only once, and a withdrawal has at most one debit and
            # one reversal. Even a bug that calls the service twice can't double the money.
            models.UniqueConstraint(fields=["topup_request"], name="ledger_one_entry_per_topup_request"),
            models.UniqueConstraint(fields=["gateway_payment"], name="ledger_one_entry_per_gateway_payment"),
            models.UniqueConstraint(fields=["withdrawal_request", "type"], name="ledger_one_entry_per_withdrawal_type"),
            # An order is paid once; each line pays its seller and MegaBook once
            models.UniqueConstraint(fields=["order"], name="ledger_one_debit_per_order"),
            models.UniqueConstraint(fields=["order_item", "type"], name="ledger_one_entry_per_order_item_type"),
        ]

    def __str__(self):
        return f"{self.get_type_display()} {self.amount:+,} ({self.wallet})"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableLedgerError("Ledger entries can't be updated; add a compensating entry instead.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableLedgerError("Ledger entries can't be deleted; add a compensating entry instead.")

    @property
    def source(self):
        """For top-ups: "gateway" or "card_to_card" (the wallet page labels them differently)."""
        if self.type != self.Type.TOPUP:
            return None
        return "gateway" if self.gateway_payment_id else "card_to_card"


class ReviewedRequest(models.Model):
    """Fields and rules shared by top-up and withdrawal requests.

    A request starts pending; an admin moves it to a final status through a service
    function, which records who reviewed it and when. Final statuses never change:
    corrections go through a manual adjustment.
    """

    FINAL_STATUSES = ()  # set by each subclass (each also defines user and status)

    amount = models.PositiveBigIntegerField()
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            # A final status is final: guard against any code path, not only the admin
            stored = type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
            if stored in self.FINAL_STATUSES and stored != self.status:
                raise ValidationError("وضعیت نهایی درخواست قابل تغییر نیست؛ برای اصلاح، از اصلاح دستی استفاده کنید.")
        super().save(*args, **kwargs)


class TopUpRequest(ReviewedRequest):
    """Card-to-card deposit: the user transfers money to MegaBook's card outside the
    site, then reports it here; an admin checks the bank statement and approves or rejects."""

    class Status(models.TextChoices):
        PENDING = "pending", "در انتظار بررسی"
        APPROVED = "approved", "تایید شده"
        REJECTED = "rejected", "رد شده"

    FINAL_STATUSES = (Status.APPROVED, Status.REJECTED)

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="topup_requests")
    # Normalized (wallet.normalize): Latin digits, capital letters, no spaces or dashes
    tracking_number = models.CharField(max_length=50)
    deposited_at = models.DateTimeField()
    # Bank details: private storage, random name, served only to the owner and admins
    receipt = models.ImageField(upload_to=RandomName("wallet/receipts"), storage=private_storage, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.TextField(blank=True)

    class Meta(ReviewedRequest.Meta):
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="topup_amount_positive"),
            # Unique among pending and approved requests only, like ISBNs (DECISIONS 3.10):
            # a user whose request was rejected (e.g. wrong amount typed) can submit the
            # same tracking number again. Only an approved request brings money, and
            # LedgerEntry's unique topup_request makes that happen once.
            models.UniqueConstraint(
                fields=["tracking_number"],
                condition=~Q(status="rejected"),
                name="topup_tracking_unique_unless_rejected",
                violation_error_message=TRACKING_TAKEN,
            ),
            models.CheckConstraint(
                condition=(Q(status="rejected") & ~Q(rejection_reason="")) | (~Q(status="rejected") & Q(rejection_reason="")),
                name="topup_rejection_reason_matches_status",
            ),
            models.CheckConstraint(
                condition=(Q(status="pending") & Q(reviewed_at__isnull=True)) | (~Q(status="pending") & Q(reviewed_at__isnull=False)),
                name="topup_reviewed_at_matches_status",
            ),
        ]

    def __str__(self):
        return f"شارژ {self.amount:,} تومان ({self.user}، پیگیری {self.tracking_number})"

    def can_view_receipt(self, user):
        """The request's owner and admins; nobody else, not even other logged-in users."""
        if user is None or not user.is_authenticated or not user.is_active:
            return False
        return user.is_staff or self.user_id == user.pk

    def apply_rules(self):
        """Normalize the tracking number and check the fields; from clean() and save() (DECISIONS 5.5)."""
        try:
            self.tracking_number = normalize_tracking_number(self.tracking_number)
        except InvalidNumber as error:
            raise ValidationError({"tracking_number": str(error)})
        if self.deposited_at and self.deposited_at > timezone.now():
            raise ValidationError({"deposited_at": DEPOSIT_IN_FUTURE})
        self.rejection_reason = (self.rejection_reason or "").strip()
        if self.status == self.Status.REJECTED and not self.rejection_reason:
            raise ValidationError({"rejection_reason": REJECTION_REASON_REQUIRED})

    def clean(self):
        super().clean()
        self.apply_rules()

    def save(self, *args, **kwargs):
        self.apply_rules()
        super().save(*args, **kwargs)


class WithdrawalRequest(ReviewedRequest):
    """The user asks to withdraw to a bank card; an admin pays it out manually.

    The money leaves the wallet when the request is CREATED (services.create_withdrawal),
    not when it's completed; otherwise the user could spend it on books before the
    payout and the balance would go negative. Rejecting adds a reversal entry.

    The card number lives only here, never on the user.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "در انتظار پرداخت"
        COMPLETED = "completed", "پرداخت شده"
        REJECTED = "rejected", "رد شده"

    FINAL_STATUSES = (Status.COMPLETED, Status.REJECTED)

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="withdrawal_requests")
    # 16 Latin digits with a valid Luhn checksum (wallet.normalize)
    card_number = models.CharField(max_length=16)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    admin_note = models.TextField(blank=True)

    class Meta(ReviewedRequest.Meta):
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="withdrawal_amount_positive"),
            models.CheckConstraint(condition=Q(card_number__regex=r"^[0-9]{16}$"), name="withdrawal_card_16_digits"),
            # One pending withdrawal per user (a partial unique index)
            models.UniqueConstraint(
                fields=["user"], condition=Q(status="pending"), name="withdrawal_one_pending_per_user"
            ),
            models.CheckConstraint(
                condition=(Q(status="pending") & Q(reviewed_at__isnull=True)) | (~Q(status="pending") & Q(reviewed_at__isnull=False)),
                name="withdrawal_reviewed_at_matches_status",
            ),
        ]

    def __str__(self):
        return f"برداشت {self.amount:,} تومان ({self.user})"

    @property
    def masked_card(self):
        return mask_card_number(self.card_number)

    @property
    def grouped_card(self):
        return group_card_number(self.card_number)

    def apply_rules(self):
        try:
            self.card_number = normalize_card_number(self.card_number)
        except InvalidNumber as error:
            raise ValidationError({"card_number": str(error)})
        self.admin_note = (self.admin_note or "").strip()

    def clean(self):
        super().clean()
        self.apply_rules()

    def save(self, *args, **kwargs):
        self.apply_rules()
        super().save(*args, **kwargs)


class GatewayPayment(models.Model):
    """One online payment attempt through a payment gateway.

    A real gateway (e.g. Zarinpal) gives an id for the payment, sends the user to
    its page, and on return we ask the gateway whether it was really paid ("verify").
    Only then services.credit_gateway_payment adds the top-up entry, which links
    here; the unique link makes each payment credit the wallet once.
    The mock gateway (wallet/gateways/mock.py) creates and verifies at once.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "در انتظار پرداخت"
        PAID = "paid", "پرداخت شده"
        FAILED = "failed", "ناموفق"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="gateway_payments")
    amount = models.PositiveBigIntegerField()
    gateway = models.CharField(max_length=30)
    # The gateway's id for this payment (Zarinpal's "authority")
    reference = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="gateway_payment_amount_positive"),
        ]

    def __str__(self):
        return f"{self.gateway}: {self.amount:,} تومان ({self.user}، {self.get_status_display()})"
