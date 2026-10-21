from django.contrib import admin

from .models import LibraryItem


@admin.register(LibraryItem)
class LibraryItemAdmin(admin.ModelAdmin):
    """Viewable only: library items are created by checkout."""

    list_display = ("created_at", "user", "book", "order_item")
    search_fields = ("user__email", "user__phone", "book__title", "book__isbn")
    list_select_related = ("user", "book", "order_item")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
