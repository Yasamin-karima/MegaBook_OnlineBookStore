from django.urls import path

from .views import (
    MockTopupView,
    ReceiptLinkView,
    TopUpRequestListCreateView,
    TransactionListView,
    WalletView,
    WithdrawalListCreateView,
    receipt_view,
)

# All of these need login, and each user only ever sees their own wallet
urlpatterns = [
    path('', WalletView.as_view(), name='wallet'),
    path('transactions/', TransactionListView.as_view(), name='wallet_transactions'),
    # Development only: 404 unless DEBUG is on (gateways.active_gateway)
    path('mock-topup/', MockTopupView.as_view(), name='wallet_mock_topup'),
    path('topup-requests/', TopUpRequestListCreateView.as_view(), name='wallet_topup_requests'),
    # The receipt is private: a signed link first (owner only), then the image itself
    path('topup-requests/<int:pk>/receipt-link/', ReceiptLinkView.as_view(), name='wallet_receipt_link'),
    path('topup-requests/<int:pk>/receipt/', receipt_view, name='wallet_receipt'),
    path('withdrawals/', WithdrawalListCreateView.as_view(), name='wallet_withdrawals'),
]
