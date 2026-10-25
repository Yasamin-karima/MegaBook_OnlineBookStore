"""In-site notifications (DECISIONS 14).

A notification stores its TYPE and the parameters of the moment (a snapshot of the
book title, the reason, the amount), never the final sentence: texts.py builds the
Persian text and the link from them when serving, so wording can change for all
notifications at once.

Its source is linked with explicit nullable foreign keys (like the wallet ledger),
not a GenericForeignKey. SET_NULL: if the source is deleted, the notification stays
(its text uses the snapshot) but is no longer clickable.

Only notifications/services.notify creates rows, called right where the event
happens, inside the event's own transaction.
"""
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

# Notifications older than this are never returned and are deleted (lazily per user
# when they fetch their list, and for everyone by `manage.py purge_old_notifications`)
RETENTION_DAYS = 90


def retention_cutoff():
    return timezone.now() - timedelta(days=RETENTION_DAYS)


class NotificationQuerySet(models.QuerySet):
    def recent(self):
        return self.filter(created_at__gte=retention_cutoff())

    def unread(self):
        return self.filter(read_at__isnull=True)


class Notification(models.Model):
    class Type(models.TextChoices):
        # --- For the user the event is about ---
        REQUEST_FULFILLED = "request_fulfilled", "درخواست کتاب تأمین شد"
        REQUEST_REJECTED = "request_rejected", "درخواست کتاب رد شد"
        UPLOAD_APPROVED = "upload_approved", "بارگذاری تأیید شد"
        UPLOAD_REJECTED = "upload_rejected", "بارگذاری رد شد"
        SUPPORT_REPLY = "support_reply", "پاسخ پشتیبانی"
        TOPUP_APPROVED = "topup_approved", "شارژ کارت‌به‌کارت تأیید شد"
        TOPUP_REJECTED = "topup_rejected", "شارژ کارت‌به‌کارت رد شد"
        WITHDRAWAL_COMPLETED = "withdrawal_completed", "برداشت پرداخت شد"
        WITHDRAWAL_REJECTED = "withdrawal_rejected", "برداشت رد شد"
        SALE_INCOME = "sale_income", "درآمد فروش کتاب"
        REVIEW_HIDDEN = "review_hidden", "نظر پنهان شد"
        # --- For staff: every admin gets their own copy ---
        STAFF_NEW_UPLOAD = "staff_new_upload", "مدیر: بارگذاری تازه"
        STAFF_NEW_REQUEST = "staff_new_request", "مدیر: درخواست کتاب تازه"
        STAFF_USER_MESSAGE = "staff_user_message", "مدیر: پیام کاربر در گفت‌وگو"
        STAFF_NEW_TOPUP = "staff_new_topup", "مدیر: درخواست شارژ تازه"
        STAFF_NEW_WITHDRAWAL = "staff_new_withdrawal", "مدیر: درخواست برداشت تازه"

    # At most one UNREAD notification of these types per (recipient, conversation)
    CONVERSATION_TYPES = (Type.SUPPORT_REPLY, Type.STAFF_USER_MESSAGE)

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=30, choices=Type.choices)
    # Snapshot of what the text needs (e.g. {"title": ..., "reason": ...}); see texts.py
    params = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    # --- The source: at most a few of these are set, depending on the type ---
    book = models.ForeignKey("catalog.Book", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    book_request = models.ForeignKey(
        "book_requests.BookRequest", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    request_entry = models.ForeignKey(
        "book_requests.RequestEntry", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    conversation = models.ForeignKey(
        "support.Conversation", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    topup_request = models.ForeignKey(
        "wallet.TopUpRequest", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    withdrawal_request = models.ForeignKey(
        "wallet.WithdrawalRequest", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    order_item = models.ForeignKey("orders.OrderItem", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    review = models.ForeignKey("reviews.Review", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    objects = NotificationQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["recipient", "-created_at"], name="notification_recipient_recent"),
        ]
        constraints = [
            # One unread notification per conversation and side: a new support (or user)
            # message doesn't add another while the last one is unread. A partial unique
            # index in PostgreSQL; services.notify inserts with ON CONFLICT DO NOTHING.
            models.UniqueConstraint(
                fields=["recipient", "conversation", "type"],
                condition=Q(read_at__isnull=True) & Q(conversation__isnull=False),
                name="notification_one_unread_per_conversation",
            ),
        ]

    def __str__(self):
        return f"{self.get_type_display()} → {self.recipient}"
