from django.contrib import admin
from django.db.models import Count

from .models import BookRequest, RequestEntry


class RequestEntryInline(admin.TabularInline):
    """درخواست‌کننده‌های یک کتاب، داخل فرم همان کتاب. فقط نمایشی."""
    model = RequestEntry
    extra = 0
    fields = ("requester", "notes", "created_at")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        # درخواست‌کننده فقط از طریق API (خود کاربر) اضافه می‌شود
        return False


@admin.register(BookRequest)
class BookRequestAdmin(admin.ModelAdmin):
    list_display = ("isbn", "title", "status", "requester_count", "created_at")
    list_filter = ("status",)
    search_fields = ("isbn", "title")
    fields = ("isbn", "title", "authors", "cover_url", "status", "rejection_reason", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")
    inlines = [RequestEntryInline]

    def get_queryset(self, request):
        # تعداد درخواست‌کننده‌ها با یک COUNT در همان query فهرست، نه یک query برای هر ردیف
        return super().get_queryset(request).annotate(requester_count=Count("entries"))

    @admin.display(description="تعداد درخواست‌کننده", ordering="requester_count")
    def requester_count(self, obj):
        return obj.requester_count


@admin.register(RequestEntry)
class RequestEntryAdmin(admin.ModelAdmin):
    list_display = ("request", "requester", "created_at")
    search_fields = (
        "request__isbn", "request__title",
        "requester__email", "requester__phone", "requester__first_name", "requester__last_name",
    )
    list_select_related = ("request", "requester")
    readonly_fields = ("created_at",)
