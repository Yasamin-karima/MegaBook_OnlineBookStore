from rest_framework import serializers

from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    """What the buyer paid for one book. Never seller_share (DECISIONS 3.8)."""

    book_id = serializers.IntegerField(read_only=True)
    title = serializers.CharField(source="book.title", read_only=True)

    class Meta:
        model = OrderItem
        fields = ["book_id", "title", "price"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    total = serializers.IntegerField(read_only=True)
    count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ["id", "created_at", "items", "total", "count"]

    def get_count(self, order):
        return len(order.items.all())
