from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import NON_FIELD_ERRORS, ValidationError
from django.db import models
from django.db.models import Q

from .phone import InvalidPhone, normalize_phone

EMAIL_OR_PHONE_REQUIRED = "ایمیل یا شماره موبایل را وارد کنید."
FIRST_NAME_REQUIRED = "نام را وارد کنید."
LAST_NAME_REQUIRED = "نام خانوادگی را وارد کنید."
EMAIL_TAKEN = "با این ایمیل قبلاً حساب ساخته شده است."
PHONE_TAKEN = "با این شماره موبایل قبلاً حساب ساخته شده است."


class AccountManager(BaseUserManager):
    # Django's UserManager requires a username; this one works with email and/or phone.
    use_in_migrations = True

    @classmethod
    def normalize_email(cls, email):
        # Lowercase the WHOLE address (Django only lowercases the domain), so
        # Ali@x.com and ali@x.com can't become two accounts. Empty becomes None,
        # not "": unique allows many NULLs but only one "".
        email = (email or "").strip().lower()
        return email or None

    def get_by_natural_key(self, email):
        # Used by createsuperuser to check whether the email is taken
        return self.get(email=self.normalize_email(email))

    def _create_user(self, email, phone, password, **extra_fields):
        user = self.model(email=email, phone=phone, **extra_fields)
        # A None password becomes an unusable password, like Django's UserManager
        user.set_password(password)
        # save() normalizes the fields and enforces the rules in normalize_fields()
        user.save(using=self._db)
        return user

    def create_user(self, email=None, phone=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, phone, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields["is_staff"] is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields["is_superuser"] is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        # Superusers always have an email: it is the USERNAME_FIELD for createsuperuser and the admin
        if not self.normalize_email(email):
            raise ValueError("Superuser must have an email.")
        phone = extra_fields.pop("phone", None)
        return self._create_user(email, phone, password, **extra_fields)


class Account(AbstractUser):
    # AbstractUser gives us password (stored hashed), is_active, is_staff,
    # date_joined, last_login, groups and permissions. We remove username and
    # log in with email or phone instead.
    username = None

    # Required (AbstractUser has blank=True); never empty or only spaces (see constraints)
    first_name = models.CharField("first name", max_length=150)
    last_name = models.CharField("last name", max_length=150)

    # Both optional, but at least one is required (see constraints). Empty is
    # stored as NULL, never "", because unique allows many NULLs but only one "".
    email = models.EmailField(
        "email address", unique=True, null=True, blank=True, error_messages={"unique": EMAIL_TAKEN}
    )
    # Always 11 digits, 09xxxxxxxxx (accounts.phone.normalize_phone)
    phone = models.CharField(
        "phone number", max_length=11, unique=True, null=True, blank=True, error_messages={"unique": PHONE_TAKEN}
    )

    USERNAME_FIELD = "email"
    # Asked by createsuperuser after the email and password
    REQUIRED_FIELDS = ["first_name", "last_name"]

    objects = AccountManager()

    class Meta(AbstractUser.Meta):
        constraints = [
            # The rules below also hold for rows written without save()
            # (QuerySet.update(), raw SQL), which skip normalize_fields().
            # [^[:space:]] = at least one non-space character, so "   " fails too
            models.CheckConstraint(
                condition=Q(first_name__regex=r"[^[:space:]]"),
                name="account_first_name_not_blank",
                violation_error_message=FIRST_NAME_REQUIRED,
            ),
            models.CheckConstraint(
                condition=Q(last_name__regex=r"[^[:space:]]"),
                name="account_last_name_not_blank",
                violation_error_message=LAST_NAME_REQUIRED,
            ),
            models.CheckConstraint(
                condition=Q(email__isnull=False) | Q(phone__isnull=False),
                name="account_has_email_or_phone",
                violation_error_message=EMAIL_OR_PHONE_REQUIRED,
            ),
            models.CheckConstraint(
                condition=~Q(email=""),
                name="account_email_not_empty_string",
            ),
            models.CheckConstraint(
                condition=Q(phone__isnull=True) | Q(phone__regex=r"^09[0-9]{9}$"),
                name="account_phone_normalized",
            ),
        ]

    def __str__(self):
        return self.email or self.phone or f"Account {self.pk}"

    def normalize_fields(self):
        """Trim the names, normalize email and phone, and enforce the rules:
        both names non-empty, and at least one of email or phone.

        Called from both clean() and save(), like BookRequest.apply_status_rules
        (DECISIONS 5.5): Django calls clean() only from forms (including the admin),
        never on a plain save(). All errors are collected and raised together.
        """
        errors = {}

        self.first_name = str(self.first_name or "").strip()
        self.last_name = str(self.last_name or "").strip()
        if not self.first_name:
            errors["first_name"] = FIRST_NAME_REQUIRED
        if not self.last_name:
            errors["last_name"] = LAST_NAME_REQUIRED

        self.email = type(self).objects.normalize_email(self.email)
        if str(self.phone or "").strip():
            try:
                self.phone = normalize_phone(self.phone)
            except InvalidPhone as error:
                errors["phone"] = str(error)
        else:
            self.phone = None
        if self.email is None and self.phone is None and "phone" not in errors:
            errors[NON_FIELD_ERRORS] = EMAIL_OR_PHONE_REQUIRED

        if errors:
            raise ValidationError(errors)

    def clean(self):
        # AbstractUser.clean() runs normalize_email; ours must run after it.
        super().clean()
        self.normalize_fields()

    def save(self, *args, **kwargs):
        self.normalize_fields()
        super().save(*args, **kwargs)
