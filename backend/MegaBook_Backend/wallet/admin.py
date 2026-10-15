"""Wallet admin. Every money action calls wallet/services.py; nothing here writes
LedgerEntry rows or changes a request's status directly."""
from django import forms
from django.contrib import admin, messages
from django.contrib.admin import helpers
from django.db.models import BigIntegerField, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from . import services
from .models import GatewayPayment, LedgerEntry, TopUpRequest, Wallet, WithdrawalRequest


def toman(value):
    return f"{value:,} تومان"


class ReadOnlyAdminMixin:
    """Every field read-only; no add or delete. Status changes only through actions."""

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields] + list(self.readonly_fields)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# Wallets and the ledger
# ---------------------------------------------------------------------------

class AdjustmentForm(forms.Form):
    amount = forms.IntegerField(
        label="مبلغ (تومان)",
        help_text="مثبت برای افزایش موجودی، منفی برای کاهش. موجودی کاربر منفی نمی‌شود.",
    )
    description = forms.CharField(
        label="توضیح", max_length=255,
        help_text="دلیل اصلاح؛ در تاریخچهٔ تراکنش‌های کاربر نمایش داده می‌شود.",
    )


@admin.register(Wallet)
class WalletAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("__str__", "kind", "balance_display")
    list_filter = ("kind",)
    search_fields = ("owner__email", "owner__phone", "owner__first_name", "owner__last_name")
    list_select_related = ("owner",)
    readonly_fields = ("balance_display", "actions_display")

    def get_queryset(self, request):
        # The balance of every listed wallet in one query (SUM ... GROUP BY), not one per row
        return super().get_queryset(request).annotate(
            balance=Coalesce(Sum("entries__amount"), Value(0), output_field=BigIntegerField())
        )

    @admin.display(description="موجودی", ordering="balance")
    def balance_display(self, obj):
        # For the platform wallet this is MegaBook's total commission (and adjustments)
        return toman(obj.balance)

    @admin.display(description="عملیات")
    def actions_display(self, obj):
        entries = reverse("admin:wallet_ledgerentry_changelist") + f"?wallet__id__exact={obj.pk}"
        adjust = reverse("admin:wallet_wallet_adjust", args=[obj.pk])
        return format_html('<a href="{}">تراکنش‌ها</a> · <a href="{}">اصلاح دستی</a>', entries, adjust)

    def get_urls(self):
        return [
            path("<int:wallet_id>/adjust/", self.admin_site.admin_view(self.adjust_view), name="wallet_wallet_adjust"),
            *super().get_urls(),
        ]

    def adjust_view(self, request, wallet_id):
        wallet = get_object_or_404(Wallet, pk=wallet_id)
        if not self.has_view_permission(request, wallet) or not request.user.is_staff:
            return redirect("admin:index")
        form = AdjustmentForm(request.POST or None)
        if request.method == "POST" and form.is_valid():
            try:
                services.adjust(wallet, form.cleaned_data["amount"], form.cleaned_data["description"], request.user)
            except services.WalletError as error:
                form.add_error(error.field if error.field in form.fields else None, error.message)
            else:
                self.message_user(request, "اصلاح ثبت شد.", messages.SUCCESS)
                return redirect("admin:wallet_wallet_change", wallet.pk)
        context = {
            **self.admin_site.each_context(request),
            "title": f"اصلاح دستی: {wallet}",
            "opts": self.model._meta,
            "form": form,
            "wallet": wallet,
            "balance": toman(services.balance_of(wallet)),
        }
        return TemplateResponse(request, "admin/wallet/adjust_form.html", context)


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    """Fully read-only: entries are never edited or deleted (DECISIONS 6.1)."""

    list_display = ("created_at", "wallet", "type", "amount_display", "description", "created_by")
    list_filter = ("type", "wallet__kind")
    search_fields = ("wallet__owner__email", "wallet__owner__phone", "description")
    list_select_related = ("wallet__owner", "created_by")

    @admin.display(description="مبلغ", ordering="amount")
    def amount_display(self, obj):
        return f"{obj.amount:+,}"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# Requests: approve / reject actions
# ---------------------------------------------------------------------------

class ReasonForm(forms.Form):
    reason = forms.CharField(label="دلیل", widget=forms.Textarea(attrs={"rows": 3}))


def run_service(model_admin, request, queryset, func, done_message):
    """Call a service for each selected request and report successes and failures."""
    done, failed = 0, []
    for obj in queryset:
        try:
            func(obj)
            done += 1
        except services.WalletError as error:
            failed.append(f"{obj}: {error.message}")
    if done:
        model_admin.message_user(request, f"{done} {done_message}", messages.SUCCESS)
    for message in failed:
        model_admin.message_user(request, message, messages.ERROR)


def ask_reason(model_admin, request, queryset, action, title, on_submit):
    """An action with an intermediate page that asks for a reason (required)."""
    form = ReasonForm(request.POST if "apply" in request.POST else None)
    if "apply" in request.POST and form.is_valid():
        on_submit(form.cleaned_data["reason"])
        return None  # back to the list
    context = {
        **model_admin.admin_site.each_context(request),
        "title": title,
        "opts": model_admin.model._meta,
        "queryset": queryset,
        "form": form,
        "action": action,
        "action_checkbox_name": helpers.ACTION_CHECKBOX_NAME,
    }
    return TemplateResponse(request, "admin/wallet/reason_form.html", context)


@admin.register(TopUpRequest)
class TopUpRequestAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("created_at", "user", "amount_display", "tracking_number", "deposited_at", "status", "receipt_link")
    list_filter = ("status",)
    search_fields = ("tracking_number", "user__email", "user__phone", "user__first_name", "user__last_name")
    list_select_related = ("user",)
    readonly_fields = ("receipt_link",)
    # The raw receipt field is left out: displaying it would ask for its URL, which a
    # private file doesn't have. receipt_link goes through the download view instead.
    fields = (
        "user", "amount", "tracking_number", "deposited_at", "receipt_link", "status",
        "rejection_reason", "reviewed_by", "reviewed_at", "created_at",
    )
    actions = ["approve_selected", "reject_selected"]

    @admin.display(description="مبلغ", ordering="amount")
    def amount_display(self, obj):
        return toman(obj.amount)

    @admin.display(description="رسید")
    def receipt_link(self, obj):
        # Through the download view, which lets staff in by their admin session;
        # the receipt has no public URL
        if not obj.receipt:
            return "—"
        return format_html('<a href="{}" target="_blank">مشاهده</a>', reverse("wallet_receipt", args=[obj.pk]))

    @admin.action(description="تایید و شارژ کیف پول")
    def approve_selected(self, request, queryset):
        run_service(self, request, queryset, lambda r: services.approve_topup(r, request.user), "درخواست تایید و شارژ شد.")

    @admin.action(description="رد درخواست")
    def reject_selected(self, request, queryset):
        return ask_reason(
            self, request, queryset, "reject_selected", "رد درخواست‌های شارژ",
            lambda reason: run_service(
                self, request, queryset, lambda r: services.reject_topup(r, request.user, reason), "درخواست رد شد."
            ),
        )


@admin.register(WithdrawalRequest)
class WithdrawalRequestAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    # The holder's full name next to the full card number, so the admin can check
    # the bank shows the same name before paying
    list_display = ("created_at", "holder_name", "card_display", "amount_display", "status")
    list_filter = ("status",)
    search_fields = ("user__email", "user__phone", "user__first_name", "user__last_name")
    list_select_related = ("user",)
    readonly_fields = ("holder_name", "card_display")
    actions = ["complete_selected", "reject_selected"]

    @admin.display(description="نام صاحب حساب کاربری")
    def holder_name(self, obj):
        return obj.user.get_full_name()

    @admin.display(description="شماره کارت")
    def card_display(self, obj):
        return format_html('<span dir="ltr">{}</span>', obj.grouped_card)

    @admin.display(description="مبلغ", ordering="amount")
    def amount_display(self, obj):
        return toman(obj.amount)

    @admin.action(description="پرداخت شد")
    def complete_selected(self, request, queryset):
        run_service(self, request, queryset, lambda r: services.complete_withdrawal(r, request.user), "برداشت پرداخت‌شده ثبت شد.")

    @admin.action(description="رد درخواست و برگشت مبلغ")
    def reject_selected(self, request, queryset):
        return ask_reason(
            self, request, queryset, "reject_selected", "رد درخواست‌های برداشت",
            lambda reason: run_service(
                self, request, queryset, lambda r: services.reject_withdrawal(r, request.user, reason),
                "درخواست رد و مبلغ برگشت داده شد.",
            ),
        )


@admin.register(GatewayPayment)
class GatewayPaymentAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ("created_at", "user", "gateway", "amount", "status", "paid_at")
    list_filter = ("gateway", "status")
    search_fields = ("user__email", "user__phone", "reference")
    list_select_related = ("user",)
