from django.conf import settings
from django.http import Http404
from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from MegaBook_Backend import private_files

from . import gateways, services
from .models import LedgerEntry, TopUpRequest, WithdrawalRequest
from .serializers import (
    LedgerEntrySerializer,
    MockTopupSerializer,
    TopUpRequestSerializer,
    WithdrawalCreateSerializer,
    WithdrawalRequestSerializer,
)

# ?type= on the transaction list -> entry types (the wallet page's tabs)
TRANSACTION_FILTERS = {
    "all": None,
    "purchase": [LedgerEntry.Type.PURCHASE],
    "sale_income": [LedgerEntry.Type.SALE_INCOME],
    "topup": [LedgerEntry.Type.TOPUP],
    "withdrawal": [LedgerEntry.Type.WITHDRAWAL, LedgerEntry.Type.WITHDRAWAL_REVERSAL],
}


def wallet_error(error):
    """services.WalletError -> 400 in DRF's usual shape: {field: ["پیام"]}."""
    return ValidationError({error.field or "non_field_errors": [error.message]})


class WalletPagination(PageNumberPagination):
    page_size = 20


class WalletView(APIView):
    """GET /wallet/ -> { balance, topup_card: {number, holder} | null }

    topup_card is MegaBook's bank card for card-to-card top-ups (settings / .env).
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        card = None
        if settings.MEGABOOK_CARD_NUMBER:
            card = {"number": settings.MEGABOOK_CARD_NUMBER, "holder": settings.MEGABOOK_CARD_HOLDER}
        return Response({
            "balance": services.balance_of(services.wallet_of(request.user)),
            "topup_card": card,
        })


class TransactionListView(generics.ListAPIView):
    """GET /wallet/transactions/?type=all|purchase|sale_income|topup|withdrawal&page=<n>

    Filtering happens here, not in the page: the page only has one page of entries.
    """
    serializer_class = LedgerEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = WalletPagination

    def get_queryset(self):
        key = self.request.query_params.get("type", "all")
        if key not in TRANSACTION_FILTERS:
            raise ValidationError({"type": ["نوع تراکنش نامعتبر است."]})
        # Only the logged-in user's own wallet, never anyone else's
        queryset = LedgerEntry.objects.filter(wallet__owner=self.request.user)
        if TRANSACTION_FILTERS[key]:
            queryset = queryset.filter(type__in=TRANSACTION_FILTERS[key])
        return queryset.order_by("-created_at", "-id")


class MockTopupView(APIView):
    """POST /wallet/mock-topup/ { amount } -> instant top-up. DEBUG only.

    With DEBUG off, dispatch raises Http404 before anything else runs (even the
    login check), so the response is the same plain 404 as a URL that doesn't exist.
    """
    permission_classes = [permissions.IsAuthenticated]

    def dispatch(self, request, *args, **kwargs):
        self.gateway = gateways.active_gateway()
        return super().dispatch(request, *args, **kwargs)

    def post(self, request):
        serializer = MockTopupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = self.gateway.start_topup(request.user, serializer.validated_data["amount"])
        return Response(
            {**result, "balance": services.balance_of(services.wallet_of(request.user))},
            status=status.HTTP_201_CREATED,
        )


class TopUpRequestListCreateView(generics.ListCreateAPIView):
    """GET /wallet/topup-requests/  my card-to-card top-up requests
    POST /wallet/topup-requests/  { amount, tracking_number, deposited_at, receipt? } (multipart)
    """
    serializer_class = TopUpRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = WalletPagination
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return TopUpRequest.objects.filter(user=self.request.user)


class WithdrawalListCreateView(generics.ListCreateAPIView):
    """GET /wallet/withdrawals/  my withdrawal requests (card number masked)
    POST /wallet/withdrawals/  { amount, card_number } -> debits the wallet at once
    """
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = WalletPagination

    def get_serializer_class(self):
        return WithdrawalCreateSerializer if self.request.method == "POST" else WithdrawalRequestSerializer

    def get_queryset(self):
        return WithdrawalRequest.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = WithdrawalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            withdrawal = services.create_withdrawal(request.user, **serializer.validated_data)
        except services.WalletError as error:
            raise wallet_error(error)
        return Response(WithdrawalRequestSerializer(withdrawal).data, status=status.HTTP_201_CREATED)


# --- Top-up receipts (private; DECISIONS 3.15) ---

RECEIPT = "topup-receipt"  # the signing salt's name; a book token can't open a receipt


class ReceiptLinkView(APIView):
    """GET /wallet/topup-requests/<id>/receipt-link/ -> { url, expires_in }

    Only for the request's owner (and admins); anyone else, or a request without a
    receipt, gets 404.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        topup = TopUpRequest.objects.filter(pk=pk).first()
        if topup is None or not topup.receipt or not topup.can_view_receipt(request.user):
            return Response({"detail": "پیدا نشد."}, status=status.HTTP_404_NOT_FOUND)
        return Response(private_files.make_link(request, RECEIPT, "wallet_receipt", topup.pk, request.user))


def receipt_view(request, pk):
    """GET /wallet/topup-requests/<id>/receipt/?t=<signed token> -> the image.

    A plain Django view so a plain link works (no JWT header). Staff logged in to
    the admin need no token; that's how the admin's "view receipt" link works.
    """
    topup = TopUpRequest.objects.filter(pk=pk).first()
    user = private_files.download_user(request, RECEIPT, pk)
    if topup is None or not topup.can_view_receipt(user):
        raise Http404
    return private_files.file_response(topup.receipt, f"receipt-{topup.tracking_number}")
