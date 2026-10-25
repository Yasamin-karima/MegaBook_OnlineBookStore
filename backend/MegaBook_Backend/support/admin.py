"""Support's side of conversations, in the Django admin (until a React admin exists).

Every action goes through support/services.py: replying, closing and reopening. Nothing
here edits a message or the conversation's fields directly.
"""
from django import forms
from django.contrib import admin, messages
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html

from notifications import services as notifications

from . import services
from .models import Conversation, ConversationAdminAction, Message


class MessageInline(admin.TabularInline):
    """The transcript, read-only. Text is shown escaped (Django admin escapes it), never as HTML."""
    model = Message
    fields = ("created_at", "sender", "author", "body")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class AdminActionInline(admin.TabularInline):
    """Who closed or reopened it and when, read-only (support.services writes these)."""
    model = ConversationAdminAction
    fields = ("created_at", "action", "admin", "reason")
    readonly_fields = fields
    extra = 0
    can_delete = False
    verbose_name_plural = "بستن و بازگشایی‌ها"

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class ConversationForm(forms.ModelForm):
    """The conversation's own fields are read-only; these extra fields are actions."""

    reply = forms.CharField(
        label="پاسخ پشتیبانی", required=False, max_length=2000, widget=forms.Textarea(attrs={"rows": 4}),
        help_text="کاربر این پیام را با نام «پشتیبانی مگابوک» می‌بیند، نه با نام شما.",
    )
    close = forms.BooleanField(label="بستن گفت‌وگو", required=False)
    close_reason = forms.CharField(
        label="دلیل بستن (داخلی)", required=False, widget=forms.Textarea(attrs={"rows": 2}),
        help_text="فقط مدیران می‌بینند. کاربر فقط پیام «این گفت‌وگو توسط پشتیبانی بسته شد» را می‌بیند.",
    )
    reopen = forms.BooleanField(label="بازگشایی گفت‌وگو", required=False)

    class Meta:
        model = Conversation
        fields = ["request_entry", "book"]

    def clean(self):
        data = super().clean()
        if self.instance.pk is None and not data.get("reply", "").strip():
            # No empty conversations: starting one means writing its first message
            self.add_error("reply", "برای شروع گفت‌وگو، اولین پیام را بنویسید.")
        if data.get("close") and data.get("reopen"):
            raise forms.ValidationError("بستن و بازگشایی را با هم انتخاب نکنید.")
        if data.get("close") and not data.get("close_reason", "").strip():
            self.add_error("close_reason", services.CLOSE_REASON_REQUIRED)
        return data


class StateFilter(admin.SimpleListFilter):
    title = "وضعیت"
    parameter_name = "state"

    def lookups(self, request, model_admin):
        return [("open", "باز"), ("closed", "بسته")]

    def queryset(self, request, queryset):
        if self.value() == "open":
            return queryset.filter(closed_kind__isnull=True)
        if self.value() == "closed":
            return queryset.filter(closed_kind__isnull=False)
        return queryset


class KindFilter(admin.SimpleListFilter):
    title = "نوع"
    parameter_name = "kind"

    def lookups(self, request, model_admin):
        return [("request", "درخواست"), ("upload", "بارگذاری")]

    def queryset(self, request, queryset):
        if self.value() == "request":
            return queryset.filter(request_entry__isnull=False)
        if self.value() == "upload":
            return queryset.filter(book__isnull=False)
        return queryset


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    form = ConversationForm
    list_display = ("__str__", "owner_display", "state_display", "support_unread", "created_at")
    list_filter = (StateFilter, KindFilter)
    search_fields = (
        "request_entry__request__title", "request_entry__request__isbn", "book__title", "book__isbn",
        "request_entry__requester__email", "book__uploaded_by__email",
    )
    list_select_related = ("request_entry__request", "request_entry__requester", "book__uploaded_by")
    raw_id_fields = ("request_entry", "book")
    inlines = [MessageInline, AdminActionInline]

    def get_queryset(self, request):
        # The unread count of every listed row in the same query (no N+1)
        return super().get_queryset(request).annotate(support_unread=services.support_unread_count())

    def get_fields(self, request, obj=None):
        if obj is None:
            # Starting a conversation: pick the parent and write the first message
            return ["request_entry", "book", "reply"]
        fields = ["parent_link", "owner_display", "state_display", "closed_info", "reply"]
        return fields + (["reopen"] if obj.is_closed else ["close", "close_reason"])

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return []
        return ["parent_link", "owner_display", "state_display", "closed_info"]

    def has_delete_permission(self, request, obj=None):
        return False

    def change_view(self, request, object_id, form_url="", extra_context=None):
        # Opening the conversation counts as support reading it
        if request.method == "GET":
            Conversation.objects.filter(pk=object_id).update(support_last_read_at=timezone.now())
            # ...and THIS admin's notification for it; other admins' copies stay unread
            notifications.mark_conversation_read(
                request.user, Conversation.objects.filter(pk=object_id).first(), notifications.Type.STAFF_USER_MESSAGE
            )
        return super().change_view(request, object_id, form_url, extra_context)

    def save_model(self, request, obj, form, change):
        data = form.cleaned_data
        reply = data.get("reply", "").strip()
        try:
            if not change:
                # Create the conversation together with its first message (no empty conversations)
                parent = obj.request_entry or obj.book
                services.post_support_message(request.user, parent, reply)
                obj.pk = services.find(parent).pk
                return
            if reply:
                services.post_support_message(request.user, obj, reply)
            if data.get("close"):
                services.close(obj, request.user, data.get("close_reason"))
            if data.get("reopen"):
                services.reopen(obj, request.user)
        except services.SupportError as error:
            self.message_user(request, error.message, messages.ERROR)

    @admin.display(description="مربوط به")
    def parent_link(self, obj):
        if obj.request_entry_id:
            url = reverse("admin:book_requests_bookrequest_change", args=[obj.request_entry.request_id])
            return format_html('درخواست: <a href="{}">{}</a>', url, obj.request_entry.request)
        url = reverse("admin:catalog_book_change", args=[obj.book_id])
        return format_html('بارگذاری: <a href="{}">{}</a>', url, obj.book)

    @admin.display(description="کاربر")
    def owner_display(self, obj):
        return obj.owner

    @admin.display(description="وضعیت")
    def state_display(self, obj):
        return obj.get_closed_kind_display() if obj.is_closed else "باز"

    @admin.display(description="بسته‌شدن")
    def closed_info(self, obj):
        if not obj.is_closed:
            return "-"
        by = obj.closed_by or "خودکار"
        reason = f" — دلیل داخلی: {obj.close_reason_internal}" if obj.close_reason_internal else ""
        return f"{obj.closed_at:%Y-%m-%d %H:%M} · {by}{reason}"

    @admin.display(description="خوانده‌نشدهٔ پشتیبانی", ordering="support_unread")
    def support_unread(self, obj):
        return obj.support_unread


def conversation_link(field, parent):
    """For the RequestEntry and Book admin pages: open this parent's conversation, or
    start one (the add form, with the parent filled in)."""
    conversation = services.find(parent)
    if conversation is not None:
        return format_html('<a href="{}">باز کردن گفت‌وگو</a>', reverse("admin:support_conversation_change", args=[conversation.pk]))
    url = reverse("admin:support_conversation_add") + f"?{field}={parent.pk}"
    return format_html('<a href="{}">شروع گفت‌وگو با کاربر</a>', url)
