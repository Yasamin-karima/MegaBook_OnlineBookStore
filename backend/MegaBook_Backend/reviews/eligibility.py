"""Who may review a book: the only place this is defined (DECISIONS 13.2).

A user may review a book when:
  - the book is approved (on sale);
  - they did not upload it;
  - they bought it at checkout, paid or free (an OrderItem in one of their orders).

Not catalog/ownership.py: it counts the uploader as an owner. Not the library either:
a LibraryItem may one day come from something other than a purchase (a gift), and a
bookmark is not a purchase.

reviewable_q() is the rule itself; the book detail flag (annotate_review_flags) and
the API (review_block_reason) both use it, so they can never disagree.
"""
from django.db.models import BooleanField, Case, Exists, OuterRef, Q, Value, When

from catalog.models import Book
from orders.models import OrderItem

from .models import Review

# Machine-readable reasons the API returns as "code"
NOT_BUYER = "not_buyer"
OWN_UPLOAD = "own_upload"
BOOK_NOT_APPROVED = "book_not_approved"

MESSAGES = {
    NOT_BUYER: "فقط کسانی که این کتاب را خریده‌اند می‌توانند برایش نظر بنویسند.",
    OWN_UPLOAD: "برای کتابی که خودتان بارگذاری کرده‌اید نمی‌توانید نظر بنویسید.",
    BOOK_NOT_APPROVED: "این کتاب در حال حاضر در فروشگاه نیست و نمی‌توان برایش نظر نوشت.",
}


def purchased_q(user):
    """A Q for Book querysets: the books this user bought at checkout.

    Exists(...) rather than a JOIN on order items: inside annotate/CASE a JOIN would
    repeat each book once per order item and multiply the other annotations' counts.
    """
    bought = OrderItem.objects.filter(order__buyer=user, book=OuterRef("pk"))
    return Q(Exists(bought))


def reviewable_q(user):
    """A Q for Book querysets: the books this user may review."""
    return Q(status=Book.Status.APPROVED) & ~Q(uploaded_by=user) & purchased_q(user)


def can_review(user, book):
    if user is None or not user.is_authenticated or not user.is_active:
        return False
    return Book.objects.filter(pk=book.pk).filter(reviewable_q(user)).exists()


def review_block_reason(user, book):
    """None if the user may review the book; otherwise why not (one of the codes above).

    The yes/no comes from reviewable_q; the checks below only pick the message.
    """
    if can_review(user, book):
        return None
    if book.uploaded_by_id == user.pk:
        return OWN_UPLOAD
    if not Book.objects.filter(pk=book.pk).filter(purchased_q(user)).exists():
        return NOT_BUYER
    return BOOK_NOT_APPROVED


def annotate_review_flags(queryset, user):
    """Adds can_review and has_review to every book, in the same query (no query per book)."""
    if user is None or not user.is_authenticated or not user.is_active:
        false = Value(False, output_field=BooleanField())
        return queryset.annotate(can_review=false, has_review=false)
    return queryset.annotate(
        can_review=Case(When(reviewable_q(user), then=Value(True)), default=Value(False), output_field=BooleanField()),
        has_review=Exists(Review.objects.filter(user=user, book=OuterRef("pk"))),
    )
