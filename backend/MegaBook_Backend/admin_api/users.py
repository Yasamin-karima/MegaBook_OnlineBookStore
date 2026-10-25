"""Users: read-only. For answering "where did my money go?" or "where's the book I bought?".

Nothing here edits anything. Every number is computed (balance from the ledger,
counts with aggregate), never stored. This shows every user's email, phone and
transactions, which is why the public user list was removed (2.9): staff only.
"""
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.response import Response

from accounts.phone import InvalidPhone, normalize_phone
from book_requests.models import RequestEntry
from catalog.models import Book
from orders.models import OrderItem
from wallet.models import LedgerEntry

from .common import StaffView, balance_subquery, full_name_expression, paginate, search_terms

RECENT_LEDGER = 20


def user_fields(user):
    return {
        "id": user.pk,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.get_full_name(),
        "email": user.email,
        "phone": user.phone,
        "is_staff": user.is_staff,
        "is_active": user.is_active,
        "date_joined": user.date_joined,
        "balance": user.balance,
    }


def users_with_balance():
    return get_user_model().objects.annotate(balance=balance_subquery("pk"))


class UserListView(StaffView):
    """GET /admin-api/users/?search=&page= -> { count, next, previous, results }

    Search: full name, email, or phone (also in any form the login accepts, e.g.
    +98912…, normalized like the login). Balance is a subquery: 2 queries per page.
    """

    def get(self, request):
        queryset = users_with_balance().order_by("-date_joined", "-pk")
        text = search_terms(request)
        if text:
            q = Q(searched_name__icontains=text) | Q(email__icontains=text) | Q(phone__contains=text)
            try:
                q |= Q(phone=normalize_phone(text))
            except InvalidPhone:
                pass
            queryset = queryset.annotate(searched_name=full_name_expression()).filter(q)
        return paginate(self, request, queryset, user_fields)


class UserDetailView(StaffView):
    """GET /admin-api/users/<id>/ -> the user, balance, recent ledger entries, purchases,
    uploads and requests. One query per list (5 in all), whatever the user's history."""

    def get(self, request, pk):
        user = get_object_or_404(users_with_balance(), pk=pk)
        ledger = LedgerEntry.objects.filter(wallet__owner=user).order_by("-created_at", "-pk")
        purchases = OrderItem.objects.filter(order__buyer=user).select_related("book", "order").order_by("-order__created_at", "-pk")
        uploads = Book.objects.filter(uploaded_by=user).order_by("-created_at", "-pk")
        requests = RequestEntry.objects.filter(requester=user).select_related("request").order_by("-created_at", "-pk")
        return Response({
            **user_fields(user),
            "ledger": [
                {"id": e.pk, "type": e.type, "amount": e.amount, "description": e.description, "created_at": e.created_at}
                for e in ledger[:RECENT_LEDGER]
            ],
            "purchases": [
                {"id": item.book_id, "title": item.book.title, "price": item.price, "purchased_at": item.order.created_at}
                for item in purchases
            ],
            "uploads": [{"id": b.pk, "title": b.title, "status": b.status} for b in uploads.only("pk", "title", "status")],
            "requests": [
                {"entry_id": e.pk, "request_id": e.request_id, "title": e.request.title, "status": e.request.status}
                for e in requests
            ],
        })
