"""Shared pieces of the admin dashboard API (/admin-api/).

The React admin dashboard is the daily workplace of MegaBook's admins; the Django
admin stays as the fallback. This app has no models: every change goes through the
same model methods and service functions the rest of the project uses (Book.save,
BookRequest.save, support.services, wallet.services, Review.hide, ...), so the
rules, system messages and notifications are exactly the same whichever way an
admin works.

Access: staff only, and everyone else gets 404, never 403: a 403 would tell them
"there is something here you may not see" (the same rule as private files, 3.15).
All staff can do everything; there is no separate finance role.
"""
from django.core.exceptions import ValidationError
from django.db.models import BigIntegerField, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce, Concat
from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from wallet.models import LedgerEntry


class IsStaffOr404(BasePermission):
    """Active staff only; anyone else (a guest, a normal user) gets 404.

    An expired or invalid token still gets 401 from authentication, before this
    runs, so the frontend can refresh it and retry.
    """

    def has_permission(self, request, view):
        user = request.user
        if user is not None and user.is_authenticated and user.is_active and user.is_staff:
            return True
        raise NotFound()


class StaffView(APIView):
    permission_classes = [IsStaffOr404]


class AdminPagination(PageNumberPagination):
    page_size = 20

    def get_paginated_response(self, data, **extra):
        return Response({
            "count": self.page.paginator.count,
            "next": self.page.next_page_number() if self.page.has_next() else None,
            "previous": self.page.previous_page_number() if self.page.has_previous() else None,
            "results": data,
            **extra,
        })


def paginate(view, request, queryset, to_item, **extra):
    """One page of `queryset` as {count, next, previous, results, **extra}.
    Two queries: the count and the page."""
    paginator = AdminPagination()
    page = paginator.paginate_queryset(queryset, request, view=view)
    return paginator.get_paginated_response([to_item(row) for row in page], **extra)


def error_response(error, status=400, default_field="detail"):
    """A Django ValidationError as DRF-style {field: ["پیام"]}."""
    if isinstance(error, ValidationError) and hasattr(error, "error_dict"):
        return Response({field: list(messages) for field, messages in error.message_dict.items()}, status=status)
    messages = error.messages if isinstance(error, ValidationError) else [str(error)]
    return Response({default_field: messages}, status=status)


def full_name_expression(prefix=""):
    """first_name + " " + last_name as a database expression (for searching by full name)."""
    return Concat(f"{prefix}first_name", Value(" "), f"{prefix}last_name")


def balance_subquery(user_ref="pk"):
    """A user's wallet balance (sum of the ledger) as a subquery for a list of rows;
    user_ref is the OuterRef to the user's id. Computed, never stored (6.1)."""
    total = (
        LedgerEntry.objects.filter(wallet__owner=OuterRef(user_ref))
        .order_by()
        .values("wallet")
        .annotate(total=Sum("amount"))
        .values("total")[:1]
    )
    return Coalesce(Subquery(total, output_field=BigIntegerField()), Value(0), output_field=BigIntegerField())


def user_brief(user, balance=None):
    item = {"id": user.pk, "full_name": user.get_full_name(), "email": user.email, "phone": user.phone}
    if balance is not None:
        item["balance"] = balance
    return item


def name_of(user):
    return user.get_full_name() if user is not None else None


def absolute_media(request, file_field):
    return request.build_absolute_uri(file_field.url) if file_field else ""


def search_terms(request):
    """The ?search= text, trimmed, with Persian/Arabic digits made Latin and ISBN dashes removed."""
    text = (request.query_params.get("search") or "").strip()
    return text.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))


def choice(request, name, allowed, default):
    value = request.query_params.get(name) or default
    return value if value in allowed else default
