"""Book review: the queue of uploads and the admin's edit form.

The admin changes status, price, seller_share (after negotiating with the uploader,
3.13 and 3.14), description, category and tags. Everything is saved through
Book.save(), which already enforces the rules and does the side effects in the same
transaction:
  - an approved book needs a price, and price >= seller_share (3.11);
  - rejecting needs a reason, leaving rejected clears it;
  - a status change posts a system message in the upload's conversation (the reason
    for a rejection), notifies the uploader, and an approval fulfils the open
    BookRequest with the same ISBN, with a system message to every requester (5.14).
"""
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response

from book_requests.models import BookRequest, RequestEntry
from catalog.models import Book, Category, Tag
from support import services as support

from .common import StaffView, absolute_media, choice, error_response, full_name_expression, paginate, search_terms
from .taxonomy import clean_name

STATUS_FILTERS = ("pending", "approved", "rejected", "all")
ISBN_CONFLICT = "کتاب دیگری با این شابک در مگابوک هست (تأییدشده یا در انتظار بررسی)."
TAG_TOO_LONG = "هر برچسب حداکثر ۵۰ نویسه است."
CATEGORY_NOT_FOUND = "این دسته‌بندی پیدا نشد."


def queue_item(request, book):
    return {
        "id": book.pk,
        "title": book.title,
        "isbn": book.isbn,
        "cover": absolute_media(request, book.cover),
        "uploaded_by": {"id": book.uploaded_by_id, "full_name": book.uploaded_by.get_full_name()},
        "created_at": book.created_at,
        "status": book.status,
        "unread_count": book.unread_count,
    }


class BookQueueView(StaffView):
    """GET /admin-api/books/?status=pending|approved|rejected|all&search=&page=
    -> { count, next, previous, results, pending_count }

    Pending is oldest first (first in, first reviewed); the rest newest first.
    3 queries per page (count, page, pending_count).
    """

    def get(self, request):
        current = choice(request, "status", STATUS_FILTERS, "pending")
        queryset = Book.objects.select_related("uploaded_by").annotate(
            unread_count=support.support_unread_subquery("conversation__book")
        )
        if current != "all":
            queryset = queryset.filter(status=current)
        queryset = queryset.order_by("created_at", "pk") if current == "pending" else queryset.order_by("-created_at", "-pk")
        text = search_terms(request)
        if text:
            queryset = queryset.annotate(uploader_name=full_name_expression("uploaded_by__")).filter(
                Q(title__icontains=text) | Q(isbn__contains=text.replace("-", "")) | Q(uploader_name__icontains=text)
            )
        pending = Book.objects.filter(status=Book.Status.PENDING).count()
        return paginate(self, request, queryset, lambda b: queue_item(request, b), pending_count=pending)


def book_detail(request, pk):
    book = get_object_or_404(
        Book.objects.select_related("uploaded_by", "publisher", "category").prefetch_related(
            "authors", "translators", "tags"
        ).annotate(unread_count=support.support_unread_subquery("conversation__book")),
        pk=pk,
    )
    # Requesters of the open request for this ISBN: they're told when it's approved
    open_requesters = RequestEntry.objects.filter(
        request__isbn=book.isbn, request__status=BookRequest.Status.OPEN
    ).count()
    return {
        "id": book.pk,
        "isbn": book.isbn,
        "title": book.title,
        "original_title": book.original_title,
        "authors": "، ".join(p.name for p in book.authors.all()),
        "translators": "، ".join(p.name for p in book.translators.all()),
        "publisher": book.publisher.name if book.publisher_id else "",
        "language": book.language,
        "page_count": book.page_count,
        "publication_year": book.publication_year,
        "cover": absolute_media(request, book.cover),
        "has_file": bool(book.book_file),
        "uploaded_by": {"id": book.uploaded_by_id, "full_name": book.uploaded_by.get_full_name()},
        "uploaded_by_staff": book.uploaded_by.is_staff,
        "created_at": book.created_at,
        "status": book.status,
        "price": book.price,
        "seller_share": book.seller_share,
        "commission": book.commission,
        "description": book.description,
        "category_id": book.category_id,
        "tags": sorted(t.name for t in book.tags.all()),
        "rejection_reason": book.rejection_reason,
        "open_request_count": open_requesters,
        "unread_count": book.unread_count,
    }


class TagNamesField(serializers.ListField):
    child = serializers.CharField(allow_blank=True, trim_whitespace=True)

    def to_internal_value(self, data):
        names = []
        for raw in super().to_internal_value(data):
            name = clean_name(raw.lstrip("#"))
            if not name:
                continue
            if len(name) > 50:
                raise serializers.ValidationError(TAG_TOO_LONG)
            if name not in names:
                names.append(name)
        return names


class BookUpdateSerializer(serializers.Serializer):
    """Every field is optional: send only what changed. Rules are checked by the model."""

    status = serializers.ChoiceField(choices=Book.Status.choices, required=False)
    price = serializers.IntegerField(min_value=0, max_value=2_000_000_000, allow_null=True, required=False)
    seller_share = serializers.IntegerField(min_value=0, max_value=2_000_000_000, required=False)
    description = serializers.CharField(allow_blank=True, trim_whitespace=True, required=False)
    category_id = serializers.IntegerField(allow_null=True, required=False)
    tags = TagNamesField(required=False)
    rejection_reason = serializers.CharField(allow_blank=True, trim_whitespace=True, required=False)

    def validate_category_id(self, value):
        if value is not None and not Category.objects.filter(pk=value).exists():
            raise serializers.ValidationError(CATEGORY_NOT_FOUND)
        return value


class BookDetailView(StaffView):
    """GET   /admin-api/books/<id>/ -> the book with everything the review form needs
    PATCH /admin-api/books/<id>/ { status?, price?, seller_share?, description?, category_id?,
                                   tags? (names; unknown ones are created), rejection_reason? }
          -> the saved book, or 400 { field: ["پیام"] }"""

    def get(self, request, pk):
        return Response(book_detail(request, pk))

    def patch(self, request, pk):
        serializer = BookUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                # Locked: two admins saving the same book run one after the other
                book = get_object_or_404(Book.objects.select_for_update(), pk=pk)
                for field in ("status", "price", "seller_share", "description", "category_id", "rejection_reason"):
                    if field in data:
                        setattr(book, field, data[field])
                try:
                    # Savepoint: the ISBN constraint (e.g. a rejected book back to
                    # pending while another copy is active) fails as an IntegrityError
                    with transaction.atomic():
                        book.save()
                except IntegrityError:
                    raise ValidationError({"status": ISBN_CONFLICT})
                if "tags" in data:
                    book.tags.set([Tag.objects.get_or_create(name=name)[0] for name in data["tags"]])
        except ValidationError as error:
            return error_response(error)
        return Response(book_detail(request, pk))


# Used by the request page: a book with this ISBN, in the store or waiting for review
def books_for_isbn(isbn):
    rows = Book.objects.filter(isbn=isbn).exclude(status=Book.Status.REJECTED).values("pk", "status")
    in_store = next((r["pk"] for r in rows if r["status"] == Book.Status.APPROVED), None)
    in_review = next((r["pk"] for r in rows if r["status"] == Book.Status.PENDING), None)
    return in_store, in_review
