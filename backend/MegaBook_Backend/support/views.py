"""The owner's side of a conversation: one for each of my request entries and uploads.

Ownership is part of the database query itself (filter(..., requester=request.user) /
filter(..., uploaded_by=request.user)): someone else's id simply isn't found, and the
answer is 404, the same as an id that doesn't exist.
"""
from django.db.models import BigIntegerField, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from book_requests.models import BookRequest, RequestEntry
from catalog.models import Book
from orders.models import OrderItem
from wallet.models import LedgerEntry

from . import services
from .serializers import MessageSerializer, NewMessageSerializer, conversation_state


# --- The two kinds of parent: how to find MY one, and what the page's top card shows ---

def my_request_entry(request, pk):
    return get_object_or_404(RequestEntry.objects.select_related("request"), pk=pk, requester=request.user)


def my_upload(request, pk):
    return get_object_or_404(Book.objects.prefetch_related("authors"), pk=pk, uploaded_by=request.user)


def request_item(request, entry):
    book_request = entry.request
    item = {
        "id": entry.pk,
        "isbn": book_request.isbn,
        "title": book_request.title,
        "authors": book_request.authors,
        "cover": book_request.cover_url,
        "status": book_request.status,
        "rejection_reason": book_request.rejection_reason,
        "note": entry.notes,
        "created_at": entry.created_at,
        "book_id": None,
    }
    if book_request.status == BookRequest.Status.FULFILLED:
        # The store's book for this ISBN, if it's on sale (link "view and buy")
        item["book_id"] = (
            Book.objects.filter(isbn=book_request.isbn, status=Book.Status.APPROVED).values_list("pk", flat=True).first()
        )
    return item


def upload_item(request, book):
    """The uploader's own book. seller_share is shown to its owner only (DECISIONS 3.8
    forbids it in PUBLIC responses). Earnings come from the wallet ledger (11.2)."""
    earnings = LedgerEntry.objects.filter(
        wallet__owner=request.user, type=LedgerEntry.Type.SALE_INCOME, order_item__book=book
    ).aggregate(total=Coalesce(Sum("amount"), Value(0), output_field=BigIntegerField()))["total"]
    return {
        "id": book.pk,
        "isbn": book.isbn,
        "title": book.title,
        "authors": "، ".join(person.name for person in book.authors.all()),
        "cover": request.build_absolute_uri(book.cover.url) if book.cover else "",
        "status": book.status,
        "price": book.price,
        "seller_share": book.seller_share,
        "sales_count": OrderItem.objects.filter(book=book).count(),
        "earnings": earnings,
        "created_at": book.created_at,
    }


class ConversationView(APIView):
    """
    GET <base>/            -> { item, conversation: {state, closed_kind, user_last_read_at}, messages }
    GET <base>/?after=<id> -> the same, but only messages newer than <id> (for polling)
    A parent with no conversation yet answers state "open" and no messages; nothing is created.
    """
    permission_classes = [permissions.IsAuthenticated]
    # Set per kind in urls.py through as_view(...), which stores them on the instance
    find_parent = None
    describe = None

    def get(self, request, pk):
        parent = self.find_parent(request, pk)
        conversation = services.find(parent)
        messages = []
        if conversation is not None:
            messages = conversation.messages.all()
            after = request.query_params.get("after")
            if after and after.isdigit():
                messages = messages.filter(pk__gt=int(after))
        return Response({
            "item": self.describe(request, parent),
            "conversation": conversation_state(conversation),
            "messages": MessageSerializer(messages, many=True).data,
        })


class SendMessageView(APIView):
    """POST <base>/messages/ { text } -> 201 the saved message.
    409 { detail } if the conversation is closed. Limited to 10 messages a minute (429)."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "support_messages"
    find_parent = None

    def post(self, request, pk):
        parent = self.find_parent(request, pk)
        serializer = NewMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            message = services.post_user_message(request.user, parent, serializer.validated_data["text"])
        except services.SupportError as error:
            # Empty text is caught by the serializer; here only "closed" remains
            return Response({"detail": error.message}, status=status.HTTP_409_CONFLICT)
        return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)


class MarkReadView(APIView):
    """POST <base>/read/ -> 204. The user has seen everything up to now."""
    permission_classes = [permissions.IsAuthenticated]
    find_parent = None

    def post(self, request, pk):
        parent = self.find_parent(request, pk)
        services.mark_read_by_user(services.find(parent))
        return Response(status=status.HTTP_204_NO_CONTENT)


class UnreadView(APIView):
    """GET /support/unread/ -> { requests: {entry_id: n}, uploads: {book_id: n} }
    Only non-zero counts. Two queries in total (one GROUP BY per kind)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(services.unread_for_user(request.user))
