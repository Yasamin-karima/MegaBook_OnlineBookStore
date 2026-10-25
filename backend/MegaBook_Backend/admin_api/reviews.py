"""Reviews: only those with text, newest submission first, each "new" or "checked" (13.3).

Every change goes through the model's methods (mark_checked, hide, unhide), which lock
the row and record who and when. Hiding needs a reason that the author sees; hide()
notifies the author. Unhiding (13.3: «نمایش دوباره») clears the reason and marks it checked.
"""
from django.core.exceptions import ValidationError
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

from reviews.models import HIDE_REASON_REQUIRED, Review, ReviewHide
from reviews.serializers import author_name

from .common import StaffView, choice, full_name_expression, paginate, search_terms

FILTERS = ("new", "checked", "hidden", "all")


def new_q():
    return Q(checked_at__isnull=True, hidden_at__isnull=True)


def with_text():
    return Review.objects.exclude(body="")


def admin_reviews():
    return with_text().select_related("book", "user").annotate(
        # Shown now, but was hidden at some point (the hide history in ReviewHide)
        previously_hidden=Exists(ReviewHide.objects.filter(review=OuterRef("pk"), ended_at__isnull=False))
    )


def review_item(review):
    return {
        "id": review.pk,
        "book": {"id": review.book_id, "title": review.book.title, "status": review.book.status},
        "author": {"id": review.user_id, "display_name": author_name(review.user), "full_name": review.user.get_full_name()},
        "rating": review.rating,
        "body": review.body,
        "submitted_at": review.submitted_at,
        "is_edited": review.is_edited,
        "is_checked": review.is_checked,
        "is_hidden": review.is_hidden,
        "hide_reason": review.hide_reason,
        "previously_hidden": review.previously_hidden,
    }


class ReviewListView(StaffView):
    """GET /admin-api/reviews/?filter=new|checked|hidden|all&search=&page=
    -> { count, next, previous, results, new_count }. 3 queries per page."""

    def get(self, request):
        current = choice(request, "filter", FILTERS, "new")
        queryset = admin_reviews().order_by("-submitted_at", "-pk")
        if current == "new":
            queryset = queryset.filter(new_q())
        elif current == "checked":
            queryset = queryset.filter(checked_at__isnull=False, hidden_at__isnull=True)
        elif current == "hidden":
            queryset = queryset.filter(hidden_at__isnull=False)
        text = search_terms(request)
        if text:
            queryset = queryset.annotate(author=full_name_expression("user__")).filter(
                Q(body__icontains=text) | Q(book__title__icontains=text) | Q(author__icontains=text)
            )
        return paginate(self, request, queryset, review_item, new_count=with_text().filter(new_q()).count())


class ReviewActionView(StaffView):
    """POST /admin-api/reviews/<id>/check/
    POST /admin-api/reviews/<id>/hide/ { reason }   400 without a reason
    POST /admin-api/reviews/<id>/unhide/
    -> the review. 409 when it's already hidden / not hidden."""

    action = None

    def post(self, request, pk):
        review = get_object_or_404(with_text(), pk=pk)
        try:
            if self.action == "check":
                review.mark_checked(request.user)
            elif self.action == "hide":
                review.hide(request.user, request.data.get("reason", ""))
            else:
                review.unhide(request.user)
        except ValidationError as error:
            if hasattr(error, "error_dict"):
                return Response({"reason": [HIDE_REASON_REQUIRED]}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"detail": error.messages[0]}, status=status.HTTP_409_CONFLICT)
        return Response(review_item(admin_reviews().get(pk=pk)))
