"""Review moderation in the Django admin (DECISIONS 13.3).

The list shows only reviews with text (a rating alone has nothing to moderate), last
submitted first: an edit by the author moves a review back to the top as "new".
Every action goes through the Review methods (mark_checked, hide, unhide) one review
at a time, never QuerySet.update(), so who/when/reason are always recorded.
"""
from django import forms
from django.contrib import admin, messages
from django.contrib.admin import helpers
from django.core.exceptions import ValidationError
from django.db.models import Exists, OuterRef
from django.template.response import TemplateResponse

from .models import HIDE_REASON_REQUIRED, Review, ReviewHide


class ReviewHideInline(admin.TabularInline):
    """The history of every hide, read-only."""
    model = ReviewHide
    fk_name = "review"
    fields = ("hidden_at", "hidden_by", "reason", "ended_at", "end_kind", "ended_by")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class CheckedFilter(admin.SimpleListFilter):
    title = "بررسی"
    parameter_name = "checked"

    def lookups(self, request, model_admin):
        return [("new", "جدید"), ("checked", "بررسی‌شده")]

    def queryset(self, request, queryset):
        if self.value() == "new":
            return queryset.filter(checked_at__isnull=True)
        if self.value() == "checked":
            return queryset.filter(checked_at__isnull=False)
        return queryset


class VisibilityFilter(admin.SimpleListFilter):
    title = "نمایش"
    parameter_name = "visibility"

    def lookups(self, request, model_admin):
        return [("visible", "نمایش داده می‌شود"), ("hidden", "پنهان")]

    def queryset(self, request, queryset):
        if self.value() == "visible":
            return queryset.filter(hidden_at__isnull=True)
        if self.value() == "hidden":
            return queryset.filter(hidden_at__isnull=False)
        return queryset


class PreviouslyHiddenFilter(admin.SimpleListFilter):
    title = "قبلاً پنهان‌شده"
    parameter_name = "previously_hidden"

    def lookups(self, request, model_admin):
        return [("yes", "بله")]

    def queryset(self, request, queryset):
        if self.value() == "yes":
            return queryset.filter(previously_hidden=True)
        return queryset


class HideReasonForm(forms.Form):
    reason = forms.CharField(
        label="دلیل پنهان کردن",
        widget=forms.Textarea(attrs={"rows": 3}),
        error_messages={"required": HIDE_REASON_REQUIRED},
        help_text="نویسندهٔ نظر این دلیل را کنار نظرش می‌بیند (نام شما را نمی‌بیند). کاربران دیگر آن را نمی‌بینند.",
    )


def run_on_each(model_admin, request, queryset, func, done_message):
    """Call a Review method for each selected review and report successes and failures."""
    done, failed = 0, []
    for review in queryset:
        try:
            func(review)
            done += 1
        except ValidationError as error:
            failed.append(f"{review}: {' '.join(error.messages)}")
    if done:
        model_admin.message_user(request, f"{done} {done_message}", messages.SUCCESS)
    for message in failed:
        model_admin.message_user(request, message, messages.ERROR)


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = (
        "submitted_at", "book", "user", "rating", "short_body",
        "checked_display", "visibility_display", "previously_hidden_display",
    )
    list_filter = (CheckedFilter, VisibilityFilter, PreviouslyHiddenFilter)
    search_fields = ("body", "book__title", "user__email", "user__phone", "user__first_name", "user__last_name")
    list_select_related = ("book", "user")
    ordering = ("-submitted_at", "-id")
    actions = ["mark_checked_selected", "hide_selected", "unhide_selected"]
    inlines = [ReviewHideInline]
    fields = (
        "book", "user", "rating", "body", "created_at", "submitted_at",
        "checked_by", "checked_at", "hidden_by", "hidden_at", "hide_reason",
    )
    # Nothing is edited in the form: changes go through the actions
    readonly_fields = fields

    def get_queryset(self, request):
        # Only reviews with text; "previously hidden" = shown now, hidden at some point
        hidden_before = ReviewHide.objects.filter(review=OuterRef("pk"), ended_at__isnull=False)
        return (
            super().get_queryset(request)
            .exclude(body="")
            .annotate(previously_hidden=Exists(hidden_before))
        )

    def has_add_permission(self, request):
        return False

    @admin.display(description="متن")
    def short_body(self, obj):
        return obj.body if len(obj.body) <= 80 else obj.body[:79] + "…"

    @admin.display(description="بررسی", ordering="checked_at")
    def checked_display(self, obj):
        return "بررسی‌شده" if obj.is_checked else "🆕 جدید"

    @admin.display(description="نمایش", ordering="hidden_at")
    def visibility_display(self, obj):
        return "🚫 پنهان" if obj.is_hidden else "نمایش داده می‌شود"

    @admin.display(description="قبلاً پنهان‌شده", boolean=True, ordering="previously_hidden")
    def previously_hidden_display(self, obj):
        return obj.previously_hidden and not obj.is_hidden

    @admin.action(description="علامت «بررسی‌شده»")
    def mark_checked_selected(self, request, queryset):
        run_on_each(self, request, queryset, lambda r: r.mark_checked(request.user), "نظر بررسی‌شده علامت خورد.")

    @admin.action(description="پنهان کردن (با دلیل)")
    def hide_selected(self, request, queryset):
        # An intermediate page asks for the reason (required), like the wallet's reject actions
        form = HideReasonForm(request.POST if "apply" in request.POST else None)
        if "apply" in request.POST and form.is_valid():
            reason = form.cleaned_data["reason"]
            run_on_each(self, request, queryset, lambda r: r.hide(request.user, reason), "نظر پنهان شد.")
            return None  # back to the list
        context = {
            **self.admin_site.each_context(request),
            "title": "پنهان کردن نظرها",
            "opts": self.model._meta,
            "queryset": queryset,
            "form": form,
            "action": "hide_selected",
            "action_checkbox_name": helpers.ACTION_CHECKBOX_NAME,
        }
        return TemplateResponse(request, "admin/reviews/hide_form.html", context)

    @admin.action(description="نمایش دوباره")
    def unhide_selected(self, request, queryset):
        run_on_each(self, request, queryset, lambda r: r.unhide(request.user), "نظر دوباره نمایش داده می‌شود.")
