"""Book requests: one row per ISBN (BookRequest), each with its requesters (RequestEntry).

The admin changes the status in any direction. BookRequest.save() already does the
rest (5.4, 5.5, 12.3, 12.4): rejecting needs a reason and leaving rejected clears it;
every change posts a system message into each requester's conversation; fulfilled
closes those conversations for the user (support can still write), rejected leaves
them open; fulfilled and rejected notify every requester.

"New" = an open request no admin has reviewed yet (reviewed_at empty). Any save here,
or "mark reviewed", sets reviewed_at.
"""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response

from book_requests.models import BookRequest
from support import services as support

from .books import books_for_isbn
from .common import StaffView, choice, error_response, paginate, search_terms
from .conversations import admin_state

FILTERS = ("new", "open", "fulfilled", "rejected", "all")


def new_q():
    return Q(status=BookRequest.Status.OPEN, reviewed_at__isnull=True)


def base_fields(book_request):
    return {
        "id": book_request.pk,
        "isbn": book_request.isbn,
        "title": book_request.title,
        "authors": book_request.authors,
        "cover": book_request.cover_url,
        "status": book_request.status,
        "rejection_reason": book_request.rejection_reason,
        "created_at": book_request.created_at,
        "reviewed_at": book_request.reviewed_at,
    }


class RequestQueueView(StaffView):
    """GET /admin-api/book-requests/?filter=new|open|fulfilled|rejected|all&search=&page=
    -> { count, next, previous, results, new_count }

    "new" and "open": most requesters first (the most wanted books on top); the rest
    newest first. requester_count (Count) and unread_count (a subquery summing every
    requester's conversation) are in the page's own query: 3 queries per page.
    """

    def get(self, request):
        current = choice(request, "filter", FILTERS, "new")
        queryset = BookRequest.objects.annotate(
            requester_count=Count("entries"),
            unread_count=support.support_unread_subquery("conversation__request_entry__request"),
        )
        if current == "new":
            queryset = queryset.filter(new_q())
        elif current != "all":
            queryset = queryset.filter(status=current)
        if current in ("new", "open"):
            queryset = queryset.order_by("-requester_count", "created_at", "pk")
        else:
            queryset = queryset.order_by("-created_at", "-pk")
        text = search_terms(request)
        if text:
            queryset = queryset.filter(
                Q(title__icontains=text) | Q(authors__icontains=text) | Q(isbn__contains=text.replace("-", ""))
            )

        def to_item(row):
            return {**base_fields(row), "requester_count": row.requester_count, "unread_count": row.unread_count}

        return paginate(self, request, queryset, to_item, new_count=BookRequest.objects.filter(new_q()).count())


def request_detail(pk):
    book_request = get_object_or_404(BookRequest, pk=pk)
    entries = (
        book_request.entries.select_related("requester", "conversation__closed_by")
        .annotate(unread_count=support.support_unread_subquery("conversation__request_entry"))
        .order_by("created_at", "pk")
    )
    in_store, in_review = books_for_isbn(book_request.isbn)
    return {
        **base_fields(book_request),
        "book_in_store": {"id": in_store} if in_store else None,
        "book_in_review": {"id": in_review} if in_review else None,
        "entries": [
            {
                "id": entry.pk,
                "user": {"id": entry.requester_id, "full_name": entry.requester.get_full_name()},
                "note": entry.notes,
                "created_at": entry.created_at,
                "unread_count": entry.unread_count,
                "conversation": admin_state(getattr(entry, "conversation", None)),
            }
            for entry in entries
        ],
    }


class RequestUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=BookRequest.Status.choices)
    rejection_reason = serializers.CharField(allow_blank=True, trim_whitespace=True, required=False, default="")


class RequestDetailView(StaffView):
    """GET   /admin-api/book-requests/<id>/ -> the request, its book(s) and its requesters
    PATCH /admin-api/book-requests/<id>/ { status, rejection_reason } -> the saved request"""

    def get(self, request, pk):
        return Response(request_detail(pk))

    def patch(self, request, pk):
        serializer = RequestUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                book_request = get_object_or_404(BookRequest.objects.select_for_update(), pk=pk)
                book_request.status = serializer.validated_data["status"]
                book_request.rejection_reason = serializer.validated_data["rejection_reason"]
                book_request.reviewed_at = timezone.now()
                book_request.save()
        except ValidationError as error:
            return error_response(error)
        return Response(request_detail(pk))


class MarkReviewedView(StaffView):
    """POST /admin-api/book-requests/<id>/mark-reviewed/ -> 204. Only sets reviewed_at
    (no status change, so no messages)."""

    def post(self, request, pk):
        updated = BookRequest.objects.filter(pk=pk).update(reviewed_at=timezone.now())
        if not updated:
            return Response({"detail": "پیدا نشد."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
