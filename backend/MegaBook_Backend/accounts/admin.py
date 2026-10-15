from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import AdminUserCreationForm, UserChangeForm
from django.utils.translation import gettext_lazy as _

from .models import Account
from .phone import InvalidPhone, normalize_phone


class IdentifierFieldsMixin(forms.ModelForm):
    """Normalize email and phone in the admin forms before Django validates them.

    The model would normalize them too, but only after the field checks run: a
    formatted phone like "+98 912 ..." would first fail max_length=11, and a
    mixed-case email would pass the unique check against the stored lowercase one.
    """

    # Longer than the stored 11 digits, so formatted input reaches clean_phone
    phone = forms.CharField(label="Phone number", max_length=30, required=False)

    def clean_email(self):
        return Account.objects.normalize_email(self.cleaned_data.get("email"))

    def clean_phone(self):
        value = self.cleaned_data.get("phone")
        if not (value or "").strip():
            return None
        try:
            return normalize_phone(value)
        except InvalidPhone as error:
            raise forms.ValidationError(str(error))


# Django's own user forms name `username` in Meta, so they can't be used as-is
class AccountCreationForm(IdentifierFieldsMixin, AdminUserCreationForm):
    class Meta:
        model = Account
        fields = ("email", "phone", "first_name", "last_name")
        field_classes = {}


class AccountChangeForm(IdentifierFieldsMixin, UserChangeForm):
    class Meta:
        model = Account
        fields = "__all__"
        field_classes = {}


@admin.register(Account)
class AccountAdmin(UserAdmin):
    # UserAdmin gives the proper user admin page (hashed passwords, change-password
    # form, ...). Everything below replaces its references to `username`.
    form = AccountChangeForm
    add_form = AccountCreationForm

    fieldsets = (
        (None, {"fields": ("email", "phone", "password")}),
        (_("Personal info"), {"fields": ("first_name", "last_name")}),
        (
            _("Permissions"),
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "phone", "first_name", "last_name", "usable_password", "password1", "password2"),
            },
        ),
    )
    list_display = ("email", "phone", "first_name", "last_name", "is_staff")
    search_fields = ("email", "phone", "first_name", "last_name")
    ordering = ("email",)
