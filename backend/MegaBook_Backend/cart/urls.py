from django.urls import path

from .views import AcknowledgePricesView, CartItemDetailView, CartItemsView, CartView

# All need login; each user only ever touches their own cart
urlpatterns = [
    path('', CartView.as_view(), name='cart'),
    path('items/', CartItemsView.as_view(), name='cart_items'),
    path('items/<int:book_id>/', CartItemDetailView.as_view(), name='cart_item'),
    path('acknowledge-prices/', AcknowledgePricesView.as_view(), name='cart_acknowledge_prices'),
]
