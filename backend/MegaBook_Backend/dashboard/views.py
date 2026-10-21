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
from rest_framework.response import Response
from rest_framework.views import APIView

from book_requests.models import BookRequest, RequestEntry
from cart.models import CartItem
from catalog.models import Book
from library.models import LibraryItem
from orders.models import OrderItem
from wallet.models import LedgerEntry


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
        uploads = _counts_by(Book.objects.filter(uploaded_by=user), "status", Book.Status.values)
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
            "requests": _counts_by(
                RequestEntry.objects.filter(requester=user), "request__status", BookRequest.Status.values
            ),
            "uploads": uploads,
        })
