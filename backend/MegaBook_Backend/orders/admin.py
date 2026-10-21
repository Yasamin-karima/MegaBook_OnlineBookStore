from django.contrib import admin

from .models import Order, OrderItem


def toman(value):
    return f"{value:,} تومان"


class ReadOnlyMixin:
    """Orders are financial history: nobody adds, edits or deletes them here."""

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class OrderItemInline(ReadOnlyMixin, admin.TabularInline):
    model = OrderItem
    fields = ("book", "price_display", "seller_share_display", "commission_display")
    readonly_fields = fields
    extra = 0

    @admin.display(description="قیمت پرداخت‌شده")
    def price_display(self, item):
        return toman(item.price)

    @admin.display(description="سهم بارگذارنده")
    def seller_share_display(self, item):
        return toman(item.seller_share)

    @admin.display(description="کمیسیون مگابوک")
    def commission_display(self, item):
        return toman(item.commission)


@admin.register(Order)
class OrderAdmin(ReadOnlyMixin, admin.ModelAdmin):
    list_display = ("id", "buyer", "created_at", "total_display", "item_count")
    search_fields = ("buyer__email", "buyer__phone", "items__book__title")
    list_select_related = ("buyer",)
    fields = ("buyer", "created_at", "total_display")
    readonly_fields = fields
    inlines = [OrderItemInline]

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("items")

    @admin.display(description="جمع")
    def total_display(self, order):
        return toman(order.total)

    @admin.display(description="تعداد کتاب")
    def item_count(self, order):
        return len(order.items.all())
