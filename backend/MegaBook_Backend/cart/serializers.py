from rest_framework import serializers

from catalog.models import Book

from .models import CartItem


class CartBookSerializer(serializers.ModelSerializer):
    """The book's current public data. Like the public catalog serializers, the field
    list is explicit: never book_file (paid content) or seller_share (DECISIONS 3.8)."""

    authors = serializers.SlugRelatedField(many=True, read_only=True, slug_field="name")
    is_free = serializers.SerializerMethodField()

    class Meta:
        model = Book
        fields = ["id", "title", "authors", "cover", "price", "is_free"]

    def get_is_free(self, book):
        return book.price == 0


class CartItemSerializer(serializers.ModelSerializer):
    book = CartBookSerializer(read_only=True)
    # Set on each item by services.get_cart: ok | price_changed | unavailable
    status = serializers.CharField(read_only=True)

    class Meta:
        model = CartItem
        fields = ["book", "price_seen", "status", "added_at"]


def cart_response(cart, request):
    """services.get_cart(...) -> the JSON every cart endpoint returns."""
    return {
        "items": CartItemSerializer(cart["items"], many=True, context={"request": request}).data,
        "removed": cart["removed"],
        "count": cart["count"],
        "total": cart["total"],
        "balance": cart["balance"],
    }


class BookIdSerializer(serializers.Serializer):
    book_id = serializers.IntegerField(
        min_value=1,
        error_messages={
            "required": "شناسهٔ کتاب را بفرستید.",
            "invalid": "شناسهٔ کتاب معتبر نیست.",
            "min_value": "شناسهٔ کتاب معتبر نیست.",
        },
    )


class OptionalBookIdSerializer(BookIdSerializer):
    book_id = serializers.IntegerField(
        min_value=1, required=False, allow_null=True,
        error_messages={"invalid": "شناسهٔ کتاب معتبر نیست.", "min_value": "شناسهٔ کتاب معتبر نیست."},
    )
