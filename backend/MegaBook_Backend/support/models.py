"""Tickets: a private conversation between one user and MegaBook support (DECISIONS 12).

A conversation belongs to exactly one of:
  - one RequestEntry (one user's own request for a book; never the shared per-ISBN
    BookRequest, so users who asked for the same book never see each other's messages);
  - one uploaded Book (its uploader).

Only support/services.py creates conversations and messages. A conversation is created
lazily, with its first message: there are no empty conversations.
"""
from django.conf import settings
from django.db import models
from django.db.models import Q

from book_requests.models import RequestEntry
from catalog.models import Book

MAX_MESSAGE_LENGTH = 2000


class Conversation(models.Model):
    class ClosedKind(models.TextChoices):
        # Closed automatically because the request was fulfilled; reopens if it leaves fulfilled
        FULFILLED = "fulfilled", "بسته به‌خاطر تأمین درخواست"
        # Closed by an admin (e.g. an abusive user); only an admin reopens it
        SUPPORT = "support", "بسته‌شده به‌دست پشتیبانی"

    # --- The parent: exactly one of the two (constraint below) ---
    # OneToOne: at most one conversation per parent, guaranteed by the database (two
    # first messages at the same moment can't create two conversations).
    # CASCADE: the conversation belongs to its parent; PROTECT would stop an admin from
    # deleting, say, a rejected book that has a conversation.
    request_entry = models.OneToOneField(
        RequestEntry, on_delete=models.CASCADE, null=True, blank=True, related_name="conversation"
    )
    book = models.OneToOneField(Book, on_delete=models.CASCADE, null=True, blank=True, related_name="conversation")

    # --- Closing (DECISIONS 12.4). null closed_kind = open ---
    closed_kind = models.CharField(max_length=10, choices=ClosedKind.choices, null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    # The admin who closed it manually (null when closed automatically)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    # Internal: shown to admins only, never to the user
    close_reason_internal = models.TextField(blank=True)

    # --- Unread (DECISIONS 12.5): each side's "read up to" moment; counts are computed ---
    user_last_read_at = models.DateTimeField(null=True, blank=True)
    support_last_read_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(request_entry__isnull=False) & Q(book__isnull=True))
                | (Q(request_entry__isnull=True) & Q(book__isnull=False)),
                name="conversation_has_exactly_one_parent",
                violation_error_message="گفت‌وگو باید دقیقاً به یک درخواست یا یک بارگذاری وصل باشد.",
            ),
            # Closed means: a kind and a time; manual closing also records the admin
            models.CheckConstraint(
                condition=(Q(closed_kind__isnull=True) & Q(closed_at__isnull=True) & Q(closed_by__isnull=True))
                | (Q(closed_kind="fulfilled") & Q(closed_at__isnull=False) & Q(closed_by__isnull=True))
                | (Q(closed_kind="support") & Q(closed_at__isnull=False) & Q(closed_by__isnull=False)),
                name="conversation_closed_fields_match",
            ),
        ]

    def __str__(self):
        if self.request_entry_id:
            return f"گفت‌وگوی درخواست: {self.request_entry}"
        return f"گفت‌وگوی بارگذاری: {self.book}"

    @property
    def is_closed(self):
        return self.closed_kind is not None

    @property
    def owner(self):
        """The one user on the other side of support."""
        return self.request_entry.requester if self.request_entry_id else self.book.uploaded_by


class ConversationAdminAction(models.Model):
    """One manual close or reopen by an admin, kept forever (admins only).

    The conversation's own closed_* fields describe only its CURRENT state and are
    cleared on reopen; this keeps who did what and when, across every close/reopen
    cycle (like ReviewHide for reviews). Written only by support.services.
    """

    class Action(models.TextChoices):
        CLOSE = "close", "بستن"
        REOPEN = "reopen", "بازگشایی"

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="admin_actions")
    action = models.CharField(max_length=10, choices=Action.choices)
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    # Internal; required for closing, empty for reopening
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(action="close") & Q(reason__regex=r"[^[:space:]]")) | (Q(action="reopen") & Q(reason="")),
                name="conversation_admin_action_reason_matches",
            ),
        ]

    def __str__(self):
        return f"{self.get_action_display()} · {self.admin} · {self.created_at:%Y-%m-%d %H:%M}"


class ImmutableMessageError(Exception):
    """Raised on any attempt to change or remove a message."""


class MessageQuerySet(models.QuerySet):
    # Bulk changes skip Model.save()/delete(), so they are blocked here too
    def update(self, **kwargs):
        raise ImmutableMessageError("Messages can't be edited.")

    def delete(self):
        raise ImmutableMessageError("Messages can't be deleted.")


class Message(models.Model):
    """One message. Immutable: nobody edits or deletes it, through the API or the admin."""

    class Sender(models.TextChoices):
        USER = "user", "کاربر"
        SUPPORT = "support", "پشتیبانی مگابوک"
        SYSTEM = "system", "سیستم"

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    # Decided by the server from the authenticated user and the action, never by the client
    sender = models.CharField(max_length=10, choices=Sender.choices)
    # Who wrote it (the user, or the admin for support messages; null for system).
    # Internal: the user sees only "پشتیبانی مگابوک", never the admin's name.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    # Plain text; the frontend never renders it as HTML
    body = models.TextField(max_length=MAX_MESSAGE_LENGTH)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    objects = MessageQuerySet.as_manager()

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=~Q(body=""), name="message_body_not_empty"),
            # System messages have no author; user and support messages do
            models.CheckConstraint(
                condition=(Q(sender="system") & Q(author__isnull=True)) | (~Q(sender="system") & Q(author__isnull=False)),
                name="message_author_matches_sender",
            ),
        ]

    def __str__(self):
        return f"{self.get_sender_display()}: {self.body[:40]}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableMessageError("Messages can't be edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableMessageError("Messages can't be deleted.")
