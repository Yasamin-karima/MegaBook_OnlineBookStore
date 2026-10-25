"""Conversation rules, separate from HTTP and the admin (like wallet/services.py).

Views, the admin, and the status-change hooks in BookRequest.save() and Book.save()
call these functions; nothing else creates Conversation or Message rows.

The sender of every message is decided HERE, from who is calling and why: the API
can only create "user" messages for the logged-in owner, the admin only "support"
messages, and status changes only "system" messages.
"""
from django.db import transaction
from django.db.models import Count, F, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from book_requests.models import BookRequest, RequestEntry
from catalog.models import Book
from notifications import services as notifications

from .models import MAX_MESSAGE_LENGTH, Conversation, ConversationAdminAction, Message

CONVERSATION_CLOSED = "این گفت‌وگو بسته است و پیام تازه نمی‌پذیرد."
MESSAGE_EMPTY = "متن پیام را بنویسید."
MESSAGE_TOO_LONG = f"پیام حداکثر {MAX_MESSAGE_LENGTH:,} کاراکتر است.".translate(
    str.maketrans("0123456789,", "۰۱۲۳۴۵۶۷۸۹٬")
)
ADMIN_REQUIRED = "فقط پشتیبانی می‌تواند این کار را انجام دهد."
CLOSE_REASON_REQUIRED = "دلیل بستن را بنویسید (فقط برای مدیران دیده می‌شود)."
ALREADY_CLOSED = "این گفت‌وگو همین حالا به‌دست پشتیبانی بسته است."
NOT_CLOSED = "این گفت‌وگو باز است."

# What the user sees (system messages)
CLOSED_BY_SUPPORT = "این گفت‌وگو توسط پشتیبانی بسته شد."
REOPENED = "گفت‌وگو دوباره باز شد."
REQUEST_TEXTS = {
    BookRequest.Status.OPEN: "درخواست شما دوباره در انتظار تأمین است.",
    BookRequest.Status.FULFILLED: "درخواست شما تأمین شد و کتاب در فروشگاه قرار گرفت.",
    # The rejection reason is appended (it's the admin's text, sent to the user as is)
    BookRequest.Status.REJECTED: "درخواست شما رد شد. دلیل: {reason}",
}
BOOK_TEXTS = {
    Book.Status.APPROVED: "کتاب شما تأیید شد و در فروشگاه قرار گرفت.",
    # The rejection reason is appended (the admin's text, sent as is), like requests
    Book.Status.REJECTED: "کتاب شما رد شد. دلیل: {reason}",
}

# Who counts as "the other side" when counting unread messages
FROM_SUPPORT_SIDE = [Message.Sender.SUPPORT, Message.Sender.SYSTEM]


class SupportError(Exception):
    """A rule refused the action; `message` is Persian and shown as is."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


# ---------------------------------------------------------------------------
# Finding and locking conversations
# ---------------------------------------------------------------------------

def parent_field(parent):
    if isinstance(parent, RequestEntry):
        return "request_entry"
    if isinstance(parent, Book):
        return "book"
    raise TypeError("A conversation belongs to a RequestEntry or a Book.")


def find(parent):
    """The parent's conversation, or None (it doesn't exist until a first message)."""
    return Conversation.objects.filter(**{parent_field(parent): parent}).first()


def _locked_for(parent):
    """The parent's conversation, created if missing, and LOCKED (needs a transaction).

    get_or_create is safe under concurrency: the OneToOne unique index makes a second
    INSERT fail and get_or_create then returns the row the first one created. The lock
    makes "is it closed?" and "add the message" one step, so an admin closing it at the
    same moment can't let a user message slip in after the close.
    """
    conversation, _ = Conversation.objects.get_or_create(**{parent_field(parent): parent})
    return Conversation.objects.select_for_update().get(pk=conversation.pk)


def subject(conversation):
    """What the conversation is about: the requested book's or the upload's title."""
    if conversation.request_entry_id:
        return conversation.request_entry.request.title
    return conversation.book.title


def _clean_body(body):
    body = (body or "").strip()
    if not body:
        raise SupportError(MESSAGE_EMPTY)
    if len(body) > MAX_MESSAGE_LENGTH:
        raise SupportError(MESSAGE_TOO_LONG)
    return body


def _require_admin(admin):
    if admin is None or not admin.is_staff:
        raise SupportError(ADMIN_REQUIRED)


def _system(conversation, text):
    return Message.objects.create(conversation=conversation, sender=Message.Sender.SYSTEM, body=text)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def post_user_message(user, parent, body):
    """The owner writes. The caller (the view) has already fetched `parent` filtered by
    the owner; this checks it again so no other code path can post as someone else."""
    body = _clean_body(body)
    owner_id = parent.requester_id if isinstance(parent, RequestEntry) else parent.uploaded_by_id
    if owner_id != user.pk:
        raise PermissionError("Only the owner writes user messages.")
    with transaction.atomic():
        conversation = _locked_for(parent)
        if conversation.is_closed:
            raise SupportError(CONVERSATION_CLOSED)
        message = Message.objects.create(
            conversation=conversation, sender=Message.Sender.USER, author=user, body=body
        )
        # Writing means having read everything before it
        Conversation.objects.filter(pk=conversation.pk).update(user_last_read_at=message.created_at)
        notifications.mark_conversation_read(user, conversation)
        # Every admin; not again while their last one for this conversation is unread
        notifications.notify(
            notifications.Type.STAFF_USER_MESSAGE, notifications.STAFF,
            conversation=conversation, params={"title": subject(conversation)},
        )
    return message


def post_support_message(admin, parent_or_conversation, body):
    """Support replies (an admin; shown to the user only as «پشتیبانی مگابوک»).
    Allowed even when the conversation is closed: closing only blocks the user."""
    _require_admin(admin)
    body = _clean_body(body)
    with transaction.atomic():
        if isinstance(parent_or_conversation, Conversation):
            conversation = Conversation.objects.select_for_update().get(pk=parent_or_conversation.pk)
        else:
            conversation = _locked_for(parent_or_conversation)
        message = Message.objects.create(
            conversation=conversation, sender=Message.Sender.SUPPORT, author=admin, body=body
        )
        Conversation.objects.filter(pk=conversation.pk).update(support_last_read_at=message.created_at)
        # Replying means this admin has read it; other admins' copies stay unread
        notifications.mark_conversation_read(admin, conversation, notifications.Type.STAFF_USER_MESSAGE)
        # Not again while the owner's last one for this conversation is unread
        notifications.notify(
            notifications.Type.SUPPORT_REPLY, [conversation.owner],
            conversation=conversation, params={"title": subject(conversation)},
        )
    return message


# ---------------------------------------------------------------------------
# Closing (manual) and reopening
# ---------------------------------------------------------------------------

def close(conversation, admin, reason):
    """Close manually, e.g. for an abusive user. The reason is internal; the user sees a
    neutral system message. Still fully readable; only new user messages are blocked.
    Closing an automatically closed conversation turns it into a manual close, so it
    no longer reopens by itself."""
    _require_admin(admin)
    reason = (reason or "").strip()
    if not reason:
        raise SupportError(CLOSE_REASON_REQUIRED)
    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(pk=conversation.pk)
        if conversation.closed_kind == Conversation.ClosedKind.SUPPORT:
            raise SupportError(ALREADY_CLOSED)
        conversation.closed_kind = Conversation.ClosedKind.SUPPORT
        conversation.closed_at = timezone.now()
        conversation.closed_by = admin
        conversation.close_reason_internal = reason
        conversation.save()
        ConversationAdminAction.objects.create(
            conversation=conversation, action=ConversationAdminAction.Action.CLOSE, admin=admin, reason=reason
        )
        _system(conversation, CLOSED_BY_SUPPORT)
    return conversation


def reopen(conversation, admin):
    _require_admin(admin)
    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(pk=conversation.pk)
        if not conversation.is_closed:
            raise SupportError(NOT_CLOSED)
        _open(conversation)
        ConversationAdminAction.objects.create(
            conversation=conversation, action=ConversationAdminAction.Action.REOPEN, admin=admin
        )
        _system(conversation, REOPENED)
    return conversation


def _open(conversation):
    conversation.closed_kind = None
    conversation.closed_at = None
    conversation.closed_by = None
    conversation.close_reason_internal = ""
    conversation.save()


# ---------------------------------------------------------------------------
# Status changes (called from BookRequest.save() and Book.save(), inside their transaction)
# ---------------------------------------------------------------------------

def on_request_status_changed(book_request, previous):
    """A shared request changed status: tell EVERY requester, each in their own
    conversation (created if needed). Fulfilled closes conversations automatically;
    leaving fulfilled reopens only those closed automatically, never manual closes."""
    new = book_request.status
    text = REQUEST_TEXTS[new].format(reason=book_request.rejection_reason)
    for entry in book_request.entries.order_by("pk"):
        conversation = _locked_for(entry)
        if previous == BookRequest.Status.FULFILLED and conversation.closed_kind == Conversation.ClosedKind.FULFILLED:
            _open(conversation)
        _system(conversation, text)
        if new == BookRequest.Status.FULFILLED and not conversation.is_closed:
            conversation.closed_kind = Conversation.ClosedKind.FULFILLED
            conversation.closed_at = timezone.now()
            conversation.save()


def on_book_status_changed(book, previous):
    """An upload was approved or rejected: tell its uploader. Other changes (e.g. back
    to pending) write nothing. Closing is never automatic for uploads."""
    text = BOOK_TEXTS.get(book.status)
    if text:
        _system(_locked_for(book), text.format(reason=book.rejection_reason))


# ---------------------------------------------------------------------------
# Reading and unread counts (computed, never stored: DECISIONS 3.6)
# ---------------------------------------------------------------------------

def mark_read_by_user(conversation):
    if conversation is not None:
        Conversation.objects.filter(pk=conversation.pk).update(user_last_read_at=timezone.now())
        notifications.mark_conversation_read(conversation.owner, conversation)


def mark_read_by_support(conversation):
    Conversation.objects.filter(pk=conversation.pk).update(support_last_read_at=timezone.now())


def user_unread_count():
    """An annotation: support and system messages after the user's last read."""
    return Count(
        "messages",
        filter=Q(messages__sender__in=FROM_SUPPORT_SIDE)
        & (Q(user_last_read_at__isnull=True) | Q(messages__created_at__gt=F("user_last_read_at"))),
    )


def support_unread_count():
    """An annotation: user messages after support's last read."""
    return Count(
        "messages",
        filter=Q(messages__sender=Message.Sender.USER)
        & (Q(support_last_read_at__isnull=True) | Q(messages__created_at__gt=F("support_last_read_at"))),
    )


def user_unread_subquery(parent_field):
    """The same rule as user_unread_count, as a subquery for a list of PARENTS
    (RequestEntry or Book rows, matched by OuterRef("pk")): 0 when there's no
    conversation. A subquery rather than a JOIN, so it can sit next to other counts
    (e.g. sales) without multiplying rows."""
    unread = (
        Message.objects.filter(**{f"conversation__{parent_field}": OuterRef("pk")}, sender__in=FROM_SUPPORT_SIDE)
        .filter(
            Q(conversation__user_last_read_at__isnull=True)
            | Q(created_at__gt=F("conversation__user_last_read_at"))
        )
        .order_by()
        .values(f"conversation__{parent_field}")
        .annotate(n=Count("id"))
        .values("n")[:1]
    )
    return Coalesce(Subquery(unread, output_field=IntegerField()), Value(0))


def support_unread_subquery(lookup):
    """User messages support hasn't read yet, as a subquery for a list of rows matched
    by OuterRef("pk"). `lookup` is the path from Message to those rows: "conversation",
    "conversation__book", "conversation__request_entry", or
    "conversation__request_entry__request" (a shared request: the sum over its
    requesters' conversations). 0 when there's nothing. A subquery, not a JOIN, so it
    can sit next to other counts without multiplying rows."""
    unread = (
        Message.objects.filter(**{lookup: OuterRef("pk")}, sender=Message.Sender.USER)
        .filter(
            Q(conversation__support_last_read_at__isnull=True)
            | Q(created_at__gt=F("conversation__support_last_read_at"))
        )
        .order_by()
        .values(lookup)
        .annotate(n=Count("id"))
        .values("n")[:1]
    )
    return Coalesce(Subquery(unread, output_field=IntegerField()), Value(0))


def last_message_subqueries(parent_field):
    """{"last_message_text": …, "last_message_sender": …} annotations (null without messages)."""
    last = Message.objects.filter(**{f"conversation__{parent_field}": OuterRef("pk")}).order_by("-created_at", "-id")
    return {
        "last_message_text": Subquery(last.values("body")[:1]),
        "last_message_sender": Subquery(last.values("sender")[:1]),
    }


def unread_for_user(user):
    """{"requests": {entry_id: n}, "uploads": {book_id: n}}, only non-zero counts.
    Two queries (one GROUP BY per kind), however many conversations the user has."""
    def counts(owner_filter, parent_column):
        rows = (
            Conversation.objects.filter(**owner_filter)
            .annotate(unread=user_unread_count())
            .filter(unread__gt=0)
            .values_list(parent_column, "unread")
        )
        return {parent_id: unread for parent_id, unread in rows}

    return {
        "requests": counts({"request_entry__requester": user}, "request_entry_id"),
        "uploads": counts({"book__uploaded_by": user}, "book_id"),
    }
