from django.contrib import admin
from django.urls import reverse

from MegaBook_Backend.private_files import PrivateFileInput

from .models import Book, Category, Person, Publisher, Tag

admin.site.register([Category, Person, Publisher, Tag])


def toman(value):
    return "—" if value is None else f"{value:,} تومان"


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "isbn", "status", "price_display", "seller_share_display", "commission_display", "uploaded_by")
    list_filter = ("status", "category", "language")
    search_fields = ("title", "isbn", "authors__name")
    list_select_related = ("uploaded_by",)
    filter_horizontal = ("authors", "translators", "tags")
    readonly_fields = ("commission_display", "conversation_link", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("title", "original_title", "isbn", "status", "uploaded_by", "conversation_link")}),
        # The money split the admin agrees on while approving. Commission is derived
        # (price - seller_share) and shows the saved values: it updates after saving.
        ("پول", {"fields": ("price", "seller_share", "commission_display")}),
        ("افراد و نشر", {"fields": ("authors", "translators", "publisher", "category", "tags")}),
        ("جزئیات", {"fields": ("description", "language", "page_count", "publication_year", "edition")}),
        ("فایل‌ها", {"fields": ("cover", "sample_file", "book_file")}),
        (None, {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="گفت‌وگو با بارگذارنده")
    def conversation_link(self, obj):
        # Approving or rejecting writes a system message there (support app)
        if obj is None or obj.pk is None:
            return "—"
        from support.admin import conversation_link

        return conversation_link("book", obj)

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        # The full file is private: link to it through the permission-checked view
        url = reverse("book_file", args=[obj.pk]) if obj else None
        form.base_fields["book_file"].widget = PrivateFileInput(download_url=url)
        return form

    @admin.display(description="قیمت فروش", ordering="price")
    def price_display(self, obj):
        return toman(obj.price)

    @admin.display(description="سهم بارگذارنده", ordering="seller_share")
    def seller_share_display(self, obj):
        return toman(obj.seller_share)

    @admin.display(description="کمیسیون مگابوک")
    def commission_display(self, obj):
        return toman(obj.commission)
