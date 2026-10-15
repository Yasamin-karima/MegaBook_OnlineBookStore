from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from .models import DEPOSIT_IN_FUTURE, TRACKING_TAKEN, LedgerEntry, TopUpRequest, WithdrawalRequest
from .normalize import TRACKING_MAX_LENGTH, InvalidNumber, normalize_tracking_number

# No minimum or maximum for now; the upper bound only keeps numbers inside a
# 64-bit integer, far above any real amount.
MAX_AMOUNT = 10 ** 12
MAX_RECEIPT_MB = 5

AMOUNT_MESSAGES = {
    "required": "مبلغ را وارد کنید.",
    "null": "مبلغ را وارد کنید.",
    "invalid": "مبلغ باید یک عدد صحیح به تومان باشد.",
    "min_value": "مبلغ باید بیشتر از صفر باشد.",
    "max_value": "مبلغ بیش از حد بزرگ است.",
    "max_string_length": "مبلغ بیش از حد بزرگ است.",
}


def amount_field():
    return serializers.IntegerField(min_value=1, max_value=MAX_AMOUNT, error_messages=AMOUNT_MESSAGES)


class LedgerEntrySerializer(serializers.ModelSerializer):
    # The wallet page shows `title` (e.g. a book title for purchases, later)
    title = serializers.CharField(source="description")
    # For top-ups: "gateway" or "card_to_card"; null for other types
    source = serializers.ReadOnlyField()

    class Meta:
        model = LedgerEntry
        fields = ["id", "type", "amount", "title", "source", "created_at"]
        read_only_fields = fields


class TopUpRequestSerializer(serializers.ModelSerializer):
    amount = amount_field()
    tracking_number = serializers.CharField(
        max_length=TRACKING_MAX_LENGTH + 20,  # room for spaces and dashes before normalizing
        error_messages={"required": "شماره پیگیری واریز را وارد کنید.", "blank": "شماره پیگیری واریز را وارد کنید."},
    )
    deposited_at = serializers.DateTimeField(
        error_messages={
            "required": "زمان واریز را وارد کنید.",
            "null": "زمان واریز را وارد کنید.",
            "invalid": "زمان واریز معتبر نیست.",
        },
    )
    # write_only: the receipt is private and has no URL; the response says only whether
    # there is one, and the page asks /receipt-link/ for a short-lived signed link
    receipt = serializers.ImageField(
        required=False, write_only=True,
        error_messages={"invalid_image": "فایل انتخاب‌شده تصویر معتبری نیست.", "invalid": "فایل رسید معتبر نیست."},
    )
    has_receipt = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = TopUpRequest
        fields = [
            "id", "amount", "tracking_number", "deposited_at", "receipt", "has_receipt",
            "status", "status_label", "rejection_reason", "created_at", "reviewed_at",
        ]
        read_only_fields = ["status", "rejection_reason", "created_at", "reviewed_at"]

    def get_has_receipt(self, obj):
        return bool(obj.receipt)

    def validate_tracking_number(self, value):
        try:
            tracking = normalize_tracking_number(value)
        except InvalidNumber as error:
            raise serializers.ValidationError(str(error))
        # Checked after normalizing, so "۱۲۳ ۴۵۶" and "123456" are the same number
        if TopUpRequest.objects.exclude(status=TopUpRequest.Status.REJECTED).filter(tracking_number=tracking).exists():
            raise serializers.ValidationError(TRACKING_TAKEN)
        return tracking

    def validate_deposited_at(self, value):
        if value > timezone.now():
            raise serializers.ValidationError(DEPOSIT_IN_FUTURE)
        return value

    def validate_receipt(self, value):
        if getattr(value, "image", None) and value.image.format not in ("JPEG", "PNG"):
            raise serializers.ValidationError("تصویر رسید باید JPG یا PNG باشد.")
        if value.size > MAX_RECEIPT_MB * 1024 * 1024:
            raise serializers.ValidationError("حجم تصویر رسید باید کمتر از ۵ مگابایت باشد.")
        return value

    def create(self, validated_data):
        # A request isn't money movement: nothing reaches the ledger until an admin
        # approves it through services.approve_topup
        try:
            with transaction.atomic():
                return TopUpRequest.objects.create(user=self.context["request"].user, **validated_data)
        except IntegrityError:
            # Two requests with the same tracking number at the same moment
            raise serializers.ValidationError({"tracking_number": [TRACKING_TAKEN]})


class WithdrawalRequestSerializer(serializers.ModelSerializer):
    """Read-only view of a withdrawal. The card number is always masked in responses."""

    card_number = serializers.CharField(source="masked_card")
    status_label = serializers.CharField(source="get_status_display")

    class Meta:
        model = WithdrawalRequest
        fields = ["id", "amount", "card_number", "status", "status_label", "admin_note", "created_at", "reviewed_at"]
        read_only_fields = fields


class WithdrawalCreateSerializer(serializers.Serializer):
    amount = amount_field()
    # Format and checksum are checked in services.create_withdrawal (wallet.normalize)
    card_number = serializers.CharField(
        max_length=40, error_messages={"required": "شماره کارت را وارد کنید.", "blank": "شماره کارت را وارد کنید."},
    )


class MockTopupSerializer(serializers.Serializer):
    amount = amount_field()
