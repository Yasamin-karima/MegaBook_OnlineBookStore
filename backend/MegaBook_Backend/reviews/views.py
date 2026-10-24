from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, transaction
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Book
from catalog.views import approved_books

from .eligibility import BOOK_NOT_APPROVED, MESSAGES, NOT_BUYER, review_block_reason
from .models import Review
from .serializers import MyReviewSerializer, ReviewSerializer, ReviewWriteSerializer

ALREADY_REVIEWED = "already_reviewed"
ALREADY_REVIEWED_MESSAGE = "شما قبلاً برای این کتاب نظر ثبت کرده‌اید. می‌توانید همان را ویرایش کنید."
NOT_FOUND = "پیدا نشد."
NO_REVIEW = "شما برای این کتاب نظری ثبت نکرده‌اید."


class ReviewPagination(PageNumberPagination):
    page_size = 10


def find_book_or_none(user, book_id):
    """The book for a write request, or None (answered as 404).

    An unapproved book is 404 for anyone who neither bought nor uploaded it, like the
    public book page, so these endpoints don't reveal which pending books exist.
    """
    book = Book.objects.filter(pk=book_id).first()
    if book is None:
        return None
    if book.status != Book.Status.APPROVED and review_block_reason(user, book) == NOT_BUYER:
        return None
    return book


def refused(code, http_status=status.HTTP_403_FORBIDDEN):
    return Response({"code": code, "detail": MESSAGES.get(code, code)}, status=http_status)


def as_drf_error(error):
    # A model rule (Review.apply_rules) that the serializer didn't already catch
    raise ValidationError(error.message_dict if hasattr(error, "error_dict") else {"detail": error.messages})


class BookReviewListCreateView(generics.ListCreateAPIView):
    """
    GET  /catalog/books/<id>/reviews/?page=<n>  (public) -> visible reviews, last submitted first:
         { count, next, previous, results: [review], my_review: own review | null }
         my_review is the logged-in user's own review whatever its state, with is_hidden
         and hide_reason; it is left out of results (the page pins it on top).
    POST /catalog/books/<id>/reviews/  { rating, body? }  (logged in) -> 201 my review
         403 { code: not_buyer | own_upload | book_not_approved, detail }
         409 { code: already_reviewed, detail }
    """
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = ReviewPagination
    serializer_class = ReviewSerializer

    def get_queryset(self):
        book = approved_books().filter(pk=self.kwargs["book_id"]).first()
        if book is None:
            raise NotFound(NOT_FOUND)
        self.book = book
        queryset = Review.objects.visible().filter(book=book).select_related("user").order_by("-submitted_at", "-id")
        if self.request.user.is_authenticated:
            queryset = queryset.exclude(user=self.request.user)
        return queryset

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        mine = None
        if request.user.is_authenticated:
            mine = Review.objects.filter(book=self.book, user=request.user).select_related("user").first()
        response.data["my_review"] = MyReviewSerializer(mine).data if mine else None
        return response

    def create(self, request, *args, **kwargs):
        book = find_book_or_none(request.user, self.kwargs["book_id"])
        if book is None:
            return Response({"detail": NOT_FOUND}, status=status.HTTP_404_NOT_FOUND)
        reason = review_block_reason(request.user, book)
        if reason is not None:
            return refused(reason)
        if Review.objects.filter(user=request.user, book=book).exists():
            return Response({"code": ALREADY_REVIEWED, "detail": ALREADY_REVIEWED_MESSAGE}, status=status.HTTP_409_CONFLICT)

        data = ReviewWriteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            # Savepoint: the unique (user, book) constraint is the last guard against
            # two reviews from a double click; turn its error into the same answer
            with transaction.atomic():
                review = Review.objects.create(
                    user=request.user, book=book,
                    rating=data.validated_data["rating"], body=data.validated_data.get("body", ""),
                )
        except IntegrityError:
            return Response({"code": ALREADY_REVIEWED, "detail": ALREADY_REVIEWED_MESSAGE}, status=status.HTTP_409_CONFLICT)
        except ModelValidationError as error:
            as_drf_error(error)
        return Response(MyReviewSerializer(review).data, status=status.HTTP_201_CREATED)


class MyReviewView(APIView):
    """
    PATCH  /catalog/books/<id>/reviews/mine/  { rating?, body? } -> 200 my review
           Submitting publishes it again if an admin had hidden it, and makes it "new"
           for the admins (Review.author_submit).
    DELETE /catalog/books/<id>/reviews/mine/ -> 204
    """
    permission_classes = [permissions.IsAuthenticated]

    def _my_review(self, request, book_id):
        book = find_book_or_none(request.user, book_id)
        review = Review.objects.filter(book=book, user=request.user).first() if book else None
        return book, review

    def patch(self, request, book_id):
        book, review = self._my_review(request, book_id)
        if review is None:
            return Response({"detail": NO_REVIEW}, status=status.HTTP_404_NOT_FOUND)
        if book.status != Book.Status.APPROVED:
            return refused(BOOK_NOT_APPROVED)
        data = ReviewWriteSerializer(data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        try:
            review.author_submit(
                rating=data.validated_data.get("rating", review.rating),
                body=data.validated_data.get("body", review.body),
            )
        except ModelValidationError as error:
            as_drf_error(error)
        return Response(MyReviewSerializer(review).data)

    def delete(self, request, book_id):
        _, review = self._my_review(request, book_id)
        if review is None:
            return Response({"detail": NO_REVIEW}, status=status.HTTP_404_NOT_FOUND)
        review.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
