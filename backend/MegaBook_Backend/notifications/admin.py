from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    """Viewable only, for looking into "did this user get notified?": notifications are
    created by notifications.services.notify, never by hand."""

    list_display = ("created_at", "recipient", "type", "read_at")
    list_filter = ("type",)
    search_fields = ("recipient__email", "recipient__phone")
    list_select_related = ("recipient",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
