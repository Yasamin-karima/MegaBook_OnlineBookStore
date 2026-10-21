from django.contrib import admin

from .models import CartItem


@admin.register(CartItem)
class CartItemAdmin(admin.ModelAdmin):
    """Read-only: carts belong to their users and change only through the cart API."""

    list_display = ("added_at", "user", "book", "price_seen")
    search_fields = ("user__email", "user__phone", "book__title", "book__isbn")
    list_select_related = ("user", "book")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
