"""Support's side of the conversations, for the admin dashboard.

Two ways in:
  - per parent, used by the book review and request pages (and the inbox's panel):
      /admin-api/books/<id>/conversation/…            the upload's conversation
      /admin-api/request-entries/<id>/conversation/…  one requester's conversation
    A parent may have no conversation yet (it's created with its first message);
    reading one then answers "open" and no messages, and creates nothing.
  - the inbox, /admin-api/conversations/, every conversation in one list.

Everything that writes goes through support/services.py. Admins see who wrote each
support message and who closed a conversation; users never do (12.2).
"""
from django.db.models import OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

from book_requests.models import RequestEntry
from catalog.models import Book
from notifications import services as notifications
from support import services
from support.models import Conversation, ConversationAdminAction, Message
from support.serializers import NewMessageSerializer

from .common import StaffView, choice, full_name_expression, paginate, search_terms

NO_CONVERSATION_YET = "هنوز گفت‌وگویی شروع نشده است؛ اول پیامی بنویسید."

# Shown in the inbox's context line
REQUEST_STATUS_LABELS = {"open": "در انتظار تأمین", "fulfilled": "تأمین‌شده", "rejected": "ردشده"}
BOOK_STATUS_LABELS = {"pending": "در انتظار بررسی", "approved": "در فروشگاه", "rejected": "ردشده"}


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------

def admin_message(message):
    """A message from the admins' point of view: the author's name on support messages."""
    return {
        "id": message.pk,
        "sender": message.sender,  # "user" | "support" | "system"
        "text": message.body,
        "created_at": message.created_at,
        "author": message.author.get_full_name() if message.sender == Message.Sender.SUPPORT and message.author else None,
    }


def admin_state(conversation):
    """{state, closed_kind, closed_at, closed_by, close_reason}; a missing conversation is open.
    The internal close reason and the admin's name are for admins only."""
    if conversation is None or not conversation.is_closed:
        return {"state": "open", "closed_kind": None, "closed_at": None, "closed_by": None, "close_reason": ""}
    return {
        "state": "closed",
        "closed_kind": conversation.closed_kind,  # "fulfilled" (automatic) | "support" (manual)
        "closed_at": conversation.closed_at,
        "closed_by": conversation.closed_by.get_full_name() if conversation.closed_by_id else None,
        "close_reason": conversation.close_reason_internal,
    }


def mark_read(admin, conversation):
    """Support has read it: the unread count drops, and THIS admin's notification for it
    is read (other admins' copies stay unread), like opening it in the Django admin."""
    if conversation is not None:
        services.mark_read_by_support(conversation)
        notifications.mark_conversation_read(admin, conversation, notifications.Type.STAFF_USER_MESSAGE)


# ---------------------------------------------------------------------------
# Per-parent endpoints
# ---------------------------------------------------------------------------

def find_book(pk):
    return get_object_or_404(Book, pk=pk)


def find_entry(pk):
    return get_object_or_404(RequestEntry.objects.select_related("request", "requester"), pk=pk)


def find_conversation(parent):
    return (
        Conversation.objects.select_related("closed_by").filter(**{services.parent_field(parent): parent}).first()
    )


class ParentView(StaffView):
    find_parent = None  # set per kind in urls.py through as_view(...)


class ConversationView(ParentView):
    """GET …/conversation/            -> { conversation, messages }   (reading marks it read)
    GET …/conversation/?after=<id>   -> only newer messages, for polling (marks nothing)"""

    def get(self, request, pk):
        parent = self.find_parent(pk)
        conversation = find_conversation(parent)
        messages, history = [], []
        if conversation is not None:
            messages = conversation.messages.select_related("author")
            after = request.query_params.get("after")
            if after and after.isdigit():
                messages = messages.filter(pk__gt=int(after))
            else:
                mark_read(request.user, conversation)
                history = admin_actions(conversation)
        return Response({
            "conversation": admin_state(conversation),
            "messages": [admin_message(m) for m in messages],
            # Who closed or reopened it and when (only on the first load, not when polling)
            "history": history,
        })


class SendView(ParentView):
    """POST …/conversation/messages/ { text } -> 201 the message.
    Support may write even when the conversation is closed (closing only stops the user)."""

    def post(self, request, pk):
        parent = self.find_parent(pk)
        serializer = NewMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            message = services.post_support_message(request.user, parent, serializer.validated_data["text"])
        except services.SupportError as error:
            return Response({"text": [error.message]}, status=status.HTTP_400_BAD_REQUEST)
        message.author = request.user
        return Response(admin_message(message), status=status.HTTP_201_CREATED)


class ReadView(ParentView):
    """POST …/conversation/read/ -> 204"""

    def post(self, request, pk):
        mark_read(request.user, find_conversation(self.find_parent(pk)))
        return Response(status=status.HTTP_204_NO_CONTENT)


class CloseView(ParentView):
    """POST …/conversation/close/ { reason } -> the new state. The reason is internal;
    the user sees a neutral system message. 409 if already closed by support."""

    def post(self, request, pk):
        conversation = find_conversation(self.find_parent(pk))
        if conversation is None:
            return Response({"detail": NO_CONVERSATION_YET}, status=status.HTTP_409_CONFLICT)
        try:
            services.close(conversation, request.user, request.data.get("reason", ""))
        except services.SupportError as error:
            if error.message == services.CLOSE_REASON_REQUIRED:
                return Response({"reason": [error.message]}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"detail": error.message}, status=status.HTTP_409_CONFLICT)
        return Response({"conversation": admin_state(find_conversation(self.find_parent(pk)))})


class ReopenView(ParentView):
    """POST …/conversation/reopen/ -> the new state. 409 if it isn't closed."""

    def post(self, request, pk):
        conversation = find_conversation(self.find_parent(pk))
        if conversation is None:
            return Response({"detail": services.NOT_CLOSED}, status=status.HTTP_409_CONFLICT)
        try:
            services.reopen(conversation, request.user)
        except services.SupportError as error:
            return Response({"detail": error.message}, status=status.HTTP_409_CONFLICT)
        return Response({"conversation": admin_state(find_conversation(self.find_parent(pk)))})


# ---------------------------------------------------------------------------
# The inbox
# ---------------------------------------------------------------------------

INBOX_FILTERS = ("waiting", "open", "closed", "all")
INBOX_KINDS = ("all", "entry", "upload")


def with_last_message(queryset):
    last = Message.objects.filter(conversation=OuterRef("pk")).order_by("-created_at", "-id")
    return queryset.annotate(
        last_sender=Subquery(last.values("sender")[:1]),
        last_text=Subquery(last.values("body")[:1]),
        last_at=Subquery(last.values("created_at")[:1]),
    )


def waiting_q():
    """«Waiting for us»: an open conversation whose last message is from the user."""
    return Q(closed_kind__isnull=True, last_sender=Message.Sender.USER)


def inbox_queryset():
    return with_last_message(
        Conversation.objects.select_related(
            "request_entry__request", "request_entry__requester", "book__uploaded_by"
        )
    ).annotate(unread_count=services.support_unread_subquery("conversation"))


def waiting_count():
    return with_last_message(Conversation.objects.all()).filter(waiting_q()).count()


def inbox_item(conversation):
    if conversation.request_entry_id:
        entry = conversation.request_entry
        owner, book_request = entry.requester, entry.request
        context = {
            "title": book_request.title, "isbn": book_request.isbn, "status": book_request.status,
            "status_label": REQUEST_STATUS_LABELS.get(book_request.status, ""),
            "request_id": book_request.pk, "book_id": None,
        }
        kind, parent_id = "entry", entry.pk
    else:
        book = conversation.book
        owner = book.uploaded_by
        context = {
            "title": book.title, "isbn": book.isbn, "status": book.status,
            "status_label": BOOK_STATUS_LABELS.get(book.status, ""),
            "request_id": None, "book_id": book.pk,
        }
        kind, parent_id = "upload", book.pk
    return {
        "id": conversation.pk,
        "kind": kind,
        "parent_id": parent_id,
        "user": {"id": owner.pk, "full_name": owner.get_full_name()},
        "state": "closed" if conversation.is_closed else "open",
        "closed_kind": conversation.closed_kind,
        "context": context,
        "last_message": {
            "sender": conversation.last_sender, "text": conversation.last_text, "created_at": conversation.last_at,
        } if conversation.last_at else None,
        "unread_count": conversation.unread_count,
    }


class InboxView(StaffView):
    """GET /admin-api/conversations/?filter=waiting|open|closed|all&kind=all|entry|upload&search=&page=
    -> { count, next, previous, results, waiting_count }

    "waiting" is oldest first (whoever has waited longest); the rest newest first.
    Last message and unread count are subqueries of the page's own query: 3 queries
    per page (count, page, waiting_count), however many conversations there are.
    """

    def get(self, request):
        current = choice(request, "filter", INBOX_FILTERS, "waiting")
        kind = choice(request, "kind", INBOX_KINDS, "all")
        queryset = inbox_queryset()
        if current == "waiting":
            queryset = queryset.filter(waiting_q()).order_by("last_at", "pk")
        else:
            if current == "open":
                queryset = queryset.filter(closed_kind__isnull=True)
            elif current == "closed":
                queryset = queryset.filter(closed_kind__isnull=False)
            queryset = queryset.order_by("-last_at", "-pk")
        if kind == "entry":
            queryset = queryset.filter(request_entry__isnull=False)
        elif kind == "upload":
            queryset = queryset.filter(book__isnull=False)

        text = search_terms(request)
        if text:
            queryset = queryset.annotate(
                requester_name=full_name_expression("request_entry__requester__"),
                uploader_name=full_name_expression("book__uploaded_by__"),
            ).filter(
                Q(requester_name__icontains=text) | Q(uploader_name__icontains=text)
                | Q(request_entry__request__title__icontains=text) | Q(book__title__icontains=text)
                | Q(request_entry__request__isbn__contains=text.replace("-", ""))
                | Q(book__isbn__contains=text.replace("-", ""))
            )
        return paginate(self, request, queryset, inbox_item, waiting_count=waiting_count())


class InboxItemView(StaffView):
    """GET /admin-api/conversations/<id>/ -> one inbox row (to open a linked conversation
    that isn't in the current filter)."""

    def get(self, request, pk):
        return Response(inbox_item(get_object_or_404(inbox_queryset(), pk=pk)))


# For the users page and anything else that wants the history
def admin_actions(conversation):
    return [
        {"action": a.action, "admin": a.admin.get_full_name(), "reason": a.reason, "created_at": a.created_at}
        for a in ConversationAdminAction.objects.filter(conversation=conversation).select_related("admin")
    ]
