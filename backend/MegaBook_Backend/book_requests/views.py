import re

from django.db.models import BooleanField, Count, Exists, OuterRef, Q, Value
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.isbn import to_latin_digits
from catalog.models import BOOK_EXISTS_PENDING, Book

from . import services
from .models import BookRequest, RequestEntry
from .serializers import BookRequestCreateSerializer, PublicRequestSerializer

MESSAGES = {
    services.REQUESTED: "درخواست شما ثبت شد",
    services.AVAILABLE: "این کتاب همین حالا در فروشگاه مگابوک موجود است.",
    services.IN_REVIEW: BOOK_EXISTS_PENDING,
    services.REJECTED: "درخواست این کتاب بررسی و رد شده است.",
    services.ALREADY_REQUESTED: "قبلاً این کتاب را درخواست داده‌اید",
    services.NOT_OPEN: "این درخواست دیگر باز نیست؛ تأمین یا بسته شده است.",
}

ORDERINGS = {
    "newest": ["-created_at", "-id"],
    # Ties (same count) newest first, so the order of a page never changes between requests
    "most_requested": ["-requester_count", "-created_at", "-id"],
}


def open_requests(user):
    """Open requests with their computed fields, all in ONE query (no N+1):

    requester_count  COUNT of entries (a JOIN + GROUP BY)
    is_mine          EXISTS subquery for the current user; constant False for a guest
    book_in_review   EXISTS subquery: a pending book with the same ISBN (DECISIONS 5.10)
    """
    if user.is_authenticated:
        is_mine = Exists(RequestEntry.objects.filter(request=OuterRef("pk"), requester=user))
    else:
        is_mine = Value(False, output_field=BooleanField())
    return BookRequest.objects.filter(status=BookRequest.Status.OPEN).annotate(
        requester_count=Count("entries"),
        is_mine=is_mine,
        book_in_review=Exists(Book.objects.filter(isbn=OuterRef("isbn"), status=Book.Status.PENDING)),
    )


class PublicRequestPagination(PageNumberPagination):
    page_size = 10


class BookRequestListCreateView(ListAPIView):
    """
    GET  /book-requests/  (public, no login)
         ?ordering=newest|most_requested  ?search=<title, author or ISBN>  ?page=n
         -> { count, next, previous, results: [PublicRequestSerializer] }
         Only OPEN requests, and nothing about who asked (DECISIONS 5.11).
         About 2 queries per page (the count, then the page), +1 for the JWT user.

    POST /book-requests/  (login, JSON) { isbn, title, authors?, cover_url?, notes? }
    201 requested           ثبت شد (چه درخواست تازه، چه پیوستن به درخواست موجود؛ عمداً یکسان)
    409 available           کتاب تاییدشده در فروشگاه هست (+ book_id)
    409 in_review           کتاب بارگذاری شده و در انتظار بررسی است
    409 rejected            درخواست این شابک رد شده (+ rejection_reason)
    409 already_requested   همین کاربر قبلاً درخواست داده
    400                     ورودی نامعتبر: { field: ["پیام"] }
    409 یعنی ورودی درست بود ولی وضعیت فعلی داده‌ها اجازه‌ی ساختن نداد.
    """
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    serializer_class = PublicRequestSerializer
    pagination_class = PublicRequestPagination

    def get_queryset(self):
        queryset = open_requests(self.request.user)
        search = self.request.query_params.get("search", "").strip()
        if search:
            # An ISBN typed with Persian digits or dashes still matches the stored 13 digits
            digits = re.sub(r"[\s\-]", "", to_latin_digits(search))
            match = Q(title__icontains=search) | Q(authors__icontains=search)
            if digits.isdigit():
                match |= Q(isbn__contains=digits)
            queryset = queryset.filter(match)
        ordering = ORDERINGS.get(self.request.query_params.get("ordering"), ORDERINGS["newest"])
        return queryset.order_by(*ordering)

    def post(self, request):
        serializer = BookRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        outcome = services.submit_request(
            request.user,
            isbn=data["isbn"],
            title=data["title"],
            authors=data.get("authors", ""),
            cover_url=data.get("cover_url", ""),
            notes=data.get("notes", ""),
        )

        # پاسخ موفق عمداً کم‌جزئیات است: نه id درخواست، نه عنوان ذخیره‌شده، نه تعداد
        # درخواست‌کننده‌ها؛ هر کدام لو می‌داد که کس دیگری قبلاً این کتاب را خواسته یا نه.
        body = {"result": outcome.result, "message": MESSAGES[outcome.result], "isbn": data["isbn"]}
        if outcome.result == services.AVAILABLE:
            body["book_id"] = outcome.book_id
        elif outcome.result == services.REJECTED:
            body["rejection_reason"] = outcome.rejection_reason

        code = status.HTTP_201_CREATED if outcome.result == services.REQUESTED else status.HTTP_409_CONFLICT
        return Response(body, status=code)


class JoinRequestView(APIView):
    """
    POST /book-requests/<id>/join/  (login, no body): "I want this too" on the public list.

    Uses the same submit_request as the ISBN form, so the rules live in one place.
    Safe to repeat: the second call creates nothing and returns 200 (the unique
    (request, requester) constraint guards this in the database too).
    201 / 200 -> { result, message, request: <the updated list item> }
    409 not_open | in_review | available -> { result, message }
    404 no such request
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        book_request = get_object_or_404(BookRequest, pk=pk)
        outcome = services.submit_request(
            request.user,
            isbn=book_request.isbn,
            title=book_request.title,
            authors=book_request.authors,
            cover_url=book_request.cover_url,
            require_open=True,
        )
        body = {"result": outcome.result, "message": MESSAGES[outcome.result]}
        if outcome.result not in (services.REQUESTED, services.ALREADY_REQUESTED):
            return Response(body, status=status.HTTP_409_CONFLICT)

        # The card's new state (count + "requested by you") from the database, not guessed
        item = open_requests(request.user).filter(pk=pk).first()
        if item is not None:
            body["request"] = PublicRequestSerializer(item).data
        created = outcome.result == services.REQUESTED
        return Response(body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
