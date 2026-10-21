from django.urls import path

from .views import CheckoutView, OrderListView

# All need login; each user only sees their own orders
urlpatterns = [
    path('', OrderListView.as_view(), name='order_list'),
    path('checkout/', CheckoutView.as_view(), name='checkout'),
]
