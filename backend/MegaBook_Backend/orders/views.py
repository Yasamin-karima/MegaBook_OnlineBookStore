from rest_framework import generics, permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from cart import services as cart_services
from cart.serializers import cart_response

from . import services
from .models import Order
from .serializers import OrderSerializer


class CheckoutView(APIView):
    """
    POST /orders/checkout/ (no body) -> 201 the created order
    400 { code: empty_cart, detail }
    409 { code: cart_changed | already_owned, detail, cart }: the cart as it is now,
        so the page can show what changed without another request
    409 { code: insufficient_balance, detail, shortfall }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            order = services.checkout(request.user)
        except services.CheckoutError as error:
            body = {"code": error.code, "detail": error.message}
            if error.code == services.EMPTY_CART:
                return Response(body, status=status.HTTP_400_BAD_REQUEST)
            if error.code == services.INSUFFICIENT_BALANCE:
                body["shortfall"] = error.shortfall
            else:
                # Built after the rollback, so its clean-up (removing owned books) is kept
                body["cart"] = cart_response(cart_services.get_cart(request.user), request)
            return Response(body, status=status.HTTP_409_CONFLICT)
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)


class OrderPagination(PageNumberPagination):
    page_size = 20


class OrderListView(generics.ListAPIView):
    """GET /orders/ -> my orders, newest first, with their items and totals."""
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = OrderPagination

    def get_queryset(self):
        return Order.objects.filter(buyer=self.request.user).prefetch_related("items__book")
