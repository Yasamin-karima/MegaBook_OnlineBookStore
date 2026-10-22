"""The dashboard: one read-only summary of everything the dashboard cards show.

A separate app with no models: it only READS from accounts, wallet, cart, orders,
library, catalog and book_requests. accounts is the lowest app (everything else
points to the user), so putting this in accounts would make it depend on all of
them; a composing layer belongs above them.

Every number is computed at request time (DECISIONS 3.6) with one aggregate query
per card, so the cost doesn't grow with the user's data: about 6 queries in total
(the JWT user lookup, the ledger, the cart, requests, uploads, sales).
"""
from django.db.models import BigIntegerField, Count, Exists, OuterRef, Q, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import permissions
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from book_requests.models import BookRequest
from cart.models import CartItem
from catalog.models import Book
from library.models import LibraryItem
from orders.models import OrderItem
from wallet.models import LedgerEntry

from . import queries
from .queries import my_request_entries, my_uploads


def _sum(field, **extra):
    return Coalesce(Sum(field, **extra), Value(0), output_field=BigIntegerField())


def _counts_by(queryset, field, keys):
    """{key: count} for every key, zeros included, from one GROUP BY query."""
    counts = dict.fromkeys(keys, 0)
    # order_by(): no model ordering in the GROUP BY
    for row in queryset.order_by().values(field).annotate(n=Count("id")):
        counts[row[field]] = row["n"]
    return counts


def wallet_numbers(user):
    """Balance and total sale earnings, both from the ledger (the one source of truth
    for money, DECISIONS 6.1), in ONE query."""
    return LedgerEntry.objects.filter(wallet__owner=user).aggregate(
        balance=_sum("amount"),
        earnings=_sum("amount", filter=Q(type=LedgerEntry.Type.SALE_INCOME)),
    )


def cart_numbers(user):
    """Like the cart page: count = every book in the cart, total = current prices of
    the books that can be bought. Read-only: books the user already owns are left out
    here, while GET /cart/ deletes them (a GET for a dashboard must not write)."""
    in_library = LibraryItem.objects.filter(user=user, book=OuterRef("book"))
    items = CartItem.objects.filter(user=user).exclude(book__uploaded_by=user).filter(~Exists(in_library))
    return items.aggregate(
        count=Count("id"),
        total=_sum("book__price", filter=Q(book__status=Book.Status.APPROVED, book__price__isnull=False)),
    )


class DashboardView(APIView):
    """GET /dashboard/ -> { user, wallet, cart, requests, uploads } for the logged-in user."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        money = wallet_numbers(user)
        # The same base queries as the "My Requests & Uploads" lists (queries.py, DECISIONS 11.3)
        uploads = _counts_by(my_uploads(user), "status", Book.Status.values)
        # A sale is one order line of one of my books; free books count too (they
        # have an order but no ledger entry). This is a count, not money.
        uploads["sales"] = OrderItem.objects.filter(book__uploaded_by=user).count()
        uploads["earnings"] = money["earnings"]

        return Response({
            "user": {
                "first_name": user.first_name,
                "last_name": user.last_name,
                # NULL when missing (DECISIONS 2.5); the page shows only what exists
                "email": user.email,
                "phone": user.phone,
            },
            "wallet": {"balance": money["balance"]},
            "cart": cart_numbers(user),
            "requests": _counts_by(my_request_entries(user), "request__status", BookRequest.Status.values),
            "uploads": uploads,
        })


# ---------------------------------------------------------------------------
# "My Requests & Uploads": tracking lists (read-only, GET only)
# ---------------------------------------------------------------------------

SENDER_FOR_USER = {"user": "me", "support": "support", "system": "system"}


def _last_message(row):
    if row.last_message_text is None:
        return None
    return {"sender": SENDER_FOR_USER[row.last_message_sender], "text": row.last_message_text}


class TrackingPagination(PageNumberPagination):
    page_size = 10


class MyRequestsView(ListAPIView):
    """
    GET /dashboard/requests/?status=open|fulfilled|rejected&search=<title or ISBN>&page=n
    My own request entries, newest first. Nothing about other requesters of the same
    ISBN. No method but GET: requests can't be withdrawn, cancelled or deleted.
    Two queries per page (the count, then the page with every column).
    """
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = TrackingPagination

    def get_queryset(self):
        status = self.request.query_params.get("status")
        status = status if status in BookRequest.Status.values else None
        return queries.request_list(self.request.user, status, self.request.query_params.get("search"))

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([
            {
                "id": entry.pk,
                "isbn": entry.request.isbn,
                "title": entry.request.title,
                "authors": entry.request.authors,
                "cover": entry.request.cover_url,
                "status": entry.request.status,
                "requested_at": entry.created_at,
                "conversation_closed": entry.conversation_closed_kind is not None,
                "unread_count": entry.unread_count,
                "last_message": _last_message(entry),
                "book_id": entry.store_book_id if entry.request.status == BookRequest.Status.FULFILLED else None,
            }
            for entry in page
        ])


class MyUploadsTrackingView(ListAPIView):
    """
    GET /dashboard/uploads/?status=pending|approved|rejected&search=<title or ISBN>&page=n
    My uploads, newest first. Sales and earnings (from the wallet ledger) for approved
    books. Never the book file or any download address. GET only.
    Three queries per page (the count, the page, the authors).
    """
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = TrackingPagination

    def get_queryset(self):
        status = self.request.query_params.get("status")
        status = status if status in Book.Status.values else None
        return queries.upload_list(self.request.user, status, self.request.query_params.get("search"))

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        results = []
        for book in page:
            approved = book.status == Book.Status.APPROVED
            results.append({
                "id": book.pk,
                "isbn": book.isbn,
                "title": book.title,
                "authors": "، ".join(person.name for person in book.authors.all()),
                "cover": request.build_absolute_uri(book.cover.url) if book.cover else "",
                "status": book.status,
                "uploaded_at": book.created_at,
                "conversation_closed": book.conversation_closed_kind is not None,
                "unread_count": book.unread_count,
                "last_message": _last_message(book),
                "sales_count": book.sales_count if approved else None,
                "earnings": book.earnings if approved else None,
                "book_id": book.pk if approved else None,
            })
        return self.get_paginated_response(results)
