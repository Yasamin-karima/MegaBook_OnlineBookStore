from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import BookIdSerializer, OptionalBookIdSerializer, cart_response

# Every endpoint returns the WHOLE cart (cart_response), not just "ok": the frontend
# replaces its state with it and never computes totals or statuses itself.


class CartView(APIView):
    """
    GET    /cart/  -> my cart: { items, removed, count, total, balance }
    DELETE /cart/  -> empty it (checkout uses this after paying)
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(cart_response(services.get_cart(request.user), request))

    def delete(self, request):
        services.clear(request.user)
        return Response(cart_response(services.get_cart(request.user), request))


class CartItemsView(APIView):
    """
    POST /cart/items/ { book_id } -> 201 added, 200 already in the cart (no duplicate)
    409 { code, detail }: not_available | own_upload | already_owned | cart_full
    The price is never read from the request; the server takes it from the book.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = BookIdSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            added = services.add(request.user, serializer.validated_data["book_id"])
        except services.CartError as error:
            return Response({"code": error.code, "detail": error.message}, status=status.HTTP_409_CONFLICT)
        return Response(
            cart_response(services.get_cart(request.user), request),
            status=status.HTTP_201_CREATED if added else status.HTTP_200_OK,
        )


class CartItemDetailView(APIView):
    """DELETE /cart/items/<book_id>/ -> remove one book (not an error if it isn't there)."""
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, book_id):
        services.remove(request.user, book_id)
        return Response(cart_response(services.get_cart(request.user), request))


class AcknowledgePricesView(APIView):
    """POST /cart/acknowledge-prices/ { book_id? } -> price_changed items become ok.

    With book_id: that book only; without: every price_changed item.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = OptionalBookIdSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.acknowledge_prices(request.user, serializer.validated_data.get("book_id"))
        return Response(cart_response(services.get_cart(request.user), request))
