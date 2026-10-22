"""The base queries of "my requests" and "my uploads" (DECISIONS 11.3).

The dashboard's counters and the "My Requests & Uploads" lists are both built on
these two functions, so they can never disagree: a counter is the same query grouped
by status, a list is the same query with its columns.

Ownership is part of the query itself: everything starts from filter(<owner>=user).
"""
import re

from django.db.models import BigIntegerField, Count, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce

from book_requests.models import RequestEntry
from catalog.isbn import to_latin_digits
from catalog.models import Book
from orders.models import OrderItem
from support import services as support_services
from support.models import Conversation
from wallet.models import LedgerEntry


def my_request_entries(user):
    """Every request the user made (their own RequestEntry rows)."""
    return RequestEntry.objects.filter(requester=user)


def my_uploads(user):
    """Every book the user uploaded, in any status."""
    return Book.objects.filter(uploaded_by=user)


def _search(queryset, text, title_field, isbn_field):
    """Title contains the text, or (for digits, dashes and Persian digits) the ISBN does."""
    text = (text or "").strip()
    if not text:
        return queryset
    match = Q(**{f"{title_field}__icontains": text})
    digits = re.sub(r"[\s\-]", "", to_latin_digits(text))
    if digits.isdigit():
        match |= Q(**{f"{isbn_field}__contains": digits})
    return queryset.filter(match)


def request_list(user, status=None, search=None):
    """my_request_entries with the list's columns, in ONE query (no N+1)."""
    queryset = my_request_entries(user).select_related("request")
    if status:
        queryset = queryset.filter(request__status=status)
    queryset = _search(queryset, search, "request__title", "request__isbn")
    return queryset.annotate(
        unread_count=support_services.user_unread_subquery("request_entry"),
        conversation_closed_kind=Subquery(
            Conversation.objects.filter(request_entry=OuterRef("pk")).values("closed_kind")[:1]
        ),
        # The store's book for a fulfilled request (link to its page)
        store_book_id=Subquery(
            Book.objects.filter(isbn=OuterRef("request__isbn"), status=Book.Status.APPROVED).values("pk")[:1]
        ),
        **support_services.last_message_subqueries("request_entry"),
    ).order_by("-created_at", "-id")


def upload_list(user, status=None, search=None):
    """my_uploads with the list's columns. Sales, earnings and unread are subqueries,
    not JOINs: two counts over two different JOINs would multiply each other's rows
    (3 sales x 4 messages = 12)."""
    queryset = my_uploads(user)
    if status:
        queryset = queryset.filter(status=status)
    queryset = _search(queryset, search, "title", "isbn")
    sales = (
        OrderItem.objects.filter(book=OuterRef("pk")).order_by().values("book")
        .annotate(n=Count("id")).values("n")[:1]
    )
    # Earnings from the wallet ledger (the one source of truth for money, 11.2): the
    # uploader's sale_income entries, each linked to the order line of THIS book (10.5)
    earnings = (
        LedgerEntry.objects.filter(
            type=LedgerEntry.Type.SALE_INCOME, wallet__owner=user, order_item__book=OuterRef("pk")
        )
        .order_by().values("order_item__book").annotate(total=Sum("amount")).values("total")[:1]
    )
    return queryset.prefetch_related("authors").annotate(
        sales_count=Coalesce(Subquery(sales), Value(0)),
        earnings=Coalesce(Subquery(earnings, output_field=BigIntegerField()), Value(0), output_field=BigIntegerField()),
        unread_count=support_services.user_unread_subquery("book"),
        conversation_closed_kind=Subquery(
            Conversation.objects.filter(book=OuterRef("pk")).values("closed_kind")[:1]
        ),
        **support_services.last_message_subqueries("book"),
    ).order_by("-created_at", "-id")

