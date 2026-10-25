"""The admin home page ("today's work") and the side menu's waiting counts.

Every number is a COUNT / SUM / MIN in the database, never stored (3.6). Money
numbers come from orders and the ledger (one source for money, 6.1).
"""
from django.db.models import BigIntegerField, Count, Min, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.response import Response

from book_requests.models import BookRequest
from catalog.models import Book
from orders.models import OrderItem
from reviews.models import Review
from support.models import Conversation
from wallet.models import LedgerEntry, TopUpRequest, WithdrawalRequest

from . import jalali
from .common import StaffView
from .conversations import waiting_q, with_last_message
from .request_queue import new_q as new_request_q
from .reviews import new_q as new_review_q


def queues():
    """Each queue as a queryset plus the field that says how long its items have waited."""
    return {
        "books": (Book.objects.filter(status=Book.Status.PENDING), "created_at"),
        "requests": (BookRequest.objects.filter(new_request_q()), "created_at"),
        "conversations": (with_last_message(Conversation.objects.all()).filter(waiting_q()), "last_at"),
        "topups": (TopUpRequest.objects.filter(status=TopUpRequest.Status.PENDING), "created_at"),
        "withdrawals": (WithdrawalRequest.objects.filter(status=WithdrawalRequest.Status.PENDING), "created_at"),
        "reviews": (Review.objects.exclude(body="").filter(new_review_q()), "submitted_at"),
    }


class CountsView(StaffView):
    """GET /admin-api/counts/ -> { books, requests, conversations, wallet, reviews }
    The side menu's badges: one COUNT per queue (6 queries)."""

    def get(self, request):
        counts = {key: qs.count() for key, (qs, _) in queues().items()}
        return Response({
            "books": counts["books"],
            "requests": counts["requests"],
            "conversations": counts["conversations"],
            "wallet": counts["topups"] + counts["withdrawals"],
            "reviews": counts["reviews"],
        })


def sales_between(start, end):
    """Orders, their total, and MegaBook's commission in [start, end)."""
    items = OrderItem.objects.filter(order__created_at__gte=start, order__created_at__lt=end).aggregate(
        orders=Count("order", distinct=True),
        gross=Coalesce(Sum("price"), Value(0), output_field=BigIntegerField()),
    )
    commission = LedgerEntry.objects.filter(
        type=LedgerEntry.Type.COMMISSION, created_at__gte=start, created_at__lt=end
    ).aggregate(total=Coalesce(Sum("amount"), Value(0), output_field=BigIntegerField()))["total"]
    return items["orders"], items["gross"], commission


class SummaryView(StaffView):
    """GET /admin-api/summary/ -> { today_label, month_label, queues: {key: {count, oldest_at}}, finance }

    "Today" and "this month" are decided here, in Tehran time and the Jalali calendar.
    """

    def get(self, request):
        period = jalali.periods(timezone.now())
        result_queues = {}
        for key, (queryset, field) in queues().items():
            row = queryset.aggregate(count=Count("pk"), oldest_at=Min(field))
            result_queues[key] = {"count": row["count"], "oldest_at": row["oldest_at"]}

        sales_today, gross_today, commission_today = sales_between(period["today_start"], period["tomorrow_start"])
        sales_month, gross_month, commission_month = sales_between(period["month_start"], period["tomorrow_start"])
        pending_withdrawals = WithdrawalRequest.objects.filter(status=WithdrawalRequest.Status.PENDING).aggregate(
            total=Coalesce(Sum("amount"), Value(0), output_field=BigIntegerField())
        )["total"]
        return Response({
            "today_label": period["today_label"],
            "month_label": period["month_label"],
            "queues": result_queues,
            "finance": {
                "sales_today": sales_today, "gross_today": gross_today, "commission_today": commission_today,
                "sales_month": sales_month, "gross_month": gross_month, "commission_month": commission_month,
                "pending_withdrawals_total": pending_withdrawals,
            },
        })
