"""Wallet: card-to-card top-ups, withdrawals and manual adjustments.

Every money movement goes through wallet/services.py (6.7); nothing here creates a
LedgerEntry or changes a request's status by itself. The services lock the request
row and re-check it's still pending, so when two admins decide the same request at
the same moment, the second one gets WalletError(ALREADY_REVIEWED), answered as 409.
Approved / rejected / completed are final (6.11).
"""
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response

from wallet import services
from wallet.models import LedgerEntry, TopUpRequest, Wallet, WithdrawalRequest

from .common import StaffView, balance_subquery, choice, full_name_expression, name_of, paginate, search_terms, user_brief

USER_NOT_FOUND = "این کاربر پیدا نشد."


def wallet_error(error):
    if error.message == services.ALREADY_REVIEWED:
        return Response({"detail": error.message}, status=status.HTTP_409_CONFLICT)
    return Response({error.field or "detail": [error.message]}, status=status.HTTP_400_BAD_REQUEST)


def pending_counts():
    return {
        "topups": TopUpRequest.objects.filter(status=TopUpRequest.Status.PENDING).count(),
        "withdrawals": WithdrawalRequest.objects.filter(status=WithdrawalRequest.Status.PENDING).count(),
    }


def search_users_q(text, prefix="user__"):
    return (
        Q(**{f"{prefix}email__icontains": text}) | Q(**{f"{prefix}phone__contains": text})
        | Q(searched_name__icontains=text)
    )


def topup_item(row):
    return {
        "id": row.pk,
        "user": user_brief(row.user, row.balance),
        "amount": row.amount,
        "tracking_number": row.tracking_number,
        "deposited_at": row.deposited_at,
        "has_receipt": bool(row.receipt),
        "status": row.status,
        "rejection_reason": row.rejection_reason,
        "created_at": row.created_at,
        "reviewed_at": row.reviewed_at,
        "reviewed_by": name_of(row.reviewed_by),
    }


def withdrawal_item(row):
    return {
        "id": row.pk,
        "user": user_brief(row.user, row.balance),
        "amount": row.amount,
        # The full number, for the admin who pays it out (6.13: only staff see it)
        "card_number": row.card_number,
        "status": row.status,
        "admin_note": row.admin_note,
        "created_at": row.created_at,
        "reviewed_at": row.reviewed_at,
        "reviewed_by": name_of(row.reviewed_by),
    }


class RequestListView(StaffView):
    """GET /admin-api/wallet/<topups|withdrawals>/?status=&search=&page=
    -> { count, next, previous, results, pending: { topups, withdrawals } }

    Pending is oldest first (a queue), the rest newest first. The user's balance is a
    subquery of the page's query: 4 queries per page (count, page, two pending counts).
    """

    model = None
    to_item = None
    statuses = ()

    def get(self, request):
        current = choice(request, "status", (*self.statuses, "all"), "pending")
        queryset = self.model.objects.select_related("user", "reviewed_by").annotate(
            balance=balance_subquery("user_id")
        )
        if current != "all":
            queryset = queryset.filter(status=current)
        queryset = queryset.order_by("created_at", "pk") if current == "pending" else queryset.order_by("-created_at", "-pk")
        text = search_terms(request)
        if text:
            q = search_users_q(text)
            if self.model is TopUpRequest:
                q |= Q(tracking_number__icontains=text)
            queryset = queryset.annotate(searched_name=full_name_expression("user__")).filter(q)
        return paginate(self, request, queryset, self.to_item, pending=pending_counts())


def one(model, pk):
    return model.objects.select_related("user", "reviewed_by").annotate(balance=balance_subquery("user_id")).get(pk=pk)


class DecisionSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=True, required=False, default="")


class TopupDecisionView(StaffView):
    """POST /admin-api/wallet/topups/<id>/approve/       -> the request (credited exactly once)
    POST /admin-api/wallet/topups/<id>/reject/ {reason} -> the request
    409 if it was already decided (e.g. by another admin a moment ago)."""

    action = None

    def post(self, request, pk):
        topup = get_object_or_404(TopUpRequest, pk=pk)
        reason = DecisionSerializer(data=request.data)
        reason.is_valid(raise_exception=True)
        try:
            if self.action == "approve":
                services.approve_topup(topup, request.user)
            else:
                services.reject_topup(topup, request.user, reason.validated_data["reason"])
        except services.WalletError as error:
            return wallet_error(error)
        return Response(topup_item(one(TopUpRequest, pk)))


class WithdrawalDecisionView(StaffView):
    """POST /admin-api/wallet/withdrawals/<id>/complete/        -> paid out (no ledger entry)
    POST /admin-api/wallet/withdrawals/<id>/reject/ {reason}  -> rejected; a reversal entry
    gives the money back. 409 if it was already decided."""

    action = None

    def post(self, request, pk):
        withdrawal = get_object_or_404(WithdrawalRequest, pk=pk)
        reason = DecisionSerializer(data=request.data)
        reason.is_valid(raise_exception=True)
        try:
            if self.action == "complete":
                services.complete_withdrawal(withdrawal, request.user, reason.validated_data["reason"].strip())
            else:
                services.reject_withdrawal(withdrawal, request.user, reason.validated_data["reason"])
        except services.WalletError as error:
            return wallet_error(error)
        return Response(withdrawal_item(one(WithdrawalRequest, pk)))


class AdjustmentSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    # Signed: positive adds money, negative takes it away
    amount = serializers.IntegerField(min_value=-2_000_000_000, max_value=2_000_000_000)
    description = serializers.CharField(allow_blank=True, max_length=255)


def adjustment_item(entry):
    owner = entry.wallet.owner
    return {
        "id": entry.pk,
        "user": {"id": owner.pk, "full_name": owner.get_full_name()},
        "amount": entry.amount,
        "description": entry.description,
        "created_at": entry.created_at,
        "created_by": name_of(entry.created_by),
    }


class AdjustmentView(StaffView):
    """GET  /admin-api/wallet/adjustments/?page= -> recent manual adjustments (2 queries)
    POST /admin-api/wallet/adjustments/ { user_id, amount, description }
         -> 201 { adjustment, balance }; 400 if the description is missing, the amount
         is zero, or a negative amount would take the balance below zero (6.11)."""

    def get(self, request):
        queryset = LedgerEntry.objects.filter(type=LedgerEntry.Type.ADJUSTMENT).select_related(
            "wallet__owner", "created_by"
        ).order_by("-created_at", "-pk")
        return paginate(self, request, queryset, adjustment_item)

    def post(self, request):
        serializer = AdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = get_user_model().objects.filter(pk=data["user_id"]).first()
        wallet = Wallet.objects.filter(owner=user, kind=Wallet.Kind.USER).first() if user else None
        if wallet is None:
            return Response({"user_id": [USER_NOT_FOUND]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            entry = services.adjust(wallet, data["amount"], data["description"], request.user)
        except services.WalletError as error:
            return wallet_error(error)
        entry = LedgerEntry.objects.select_related("wallet__owner", "created_by").get(pk=entry.pk)
        return Response(
            {"adjustment": adjustment_item(entry), "balance": services.balance_of(wallet)},
            status=status.HTTP_201_CREATED,
        )


TOPUP_LIST = {"model": TopUpRequest, "to_item": topup_item, "statuses": TopUpRequest.Status.values}
WITHDRAWAL_LIST = {"model": WithdrawalRequest, "to_item": withdrawal_item, "statuses": WithdrawalRequest.Status.values}
