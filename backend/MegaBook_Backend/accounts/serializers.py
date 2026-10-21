from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import (
    EMAIL_OR_PHONE_REQUIRED,
    EMAIL_TAKEN,
    FIRST_NAME_REQUIRED,
    LAST_NAME_REQUIRED,
    PHONE_TAKEN,
)
from .phone import InvalidPhone, normalize_phone

Account = get_user_model()

# One message for every login failure (unknown identifier, wrong password,
# inactive account), so the response never reveals whether an account exists.
LOGIN_FAILED = "ایمیل/شماره موبایل یا رمز عبور اشتباه است."
EMAIL_INVALID = "ایمیل را به شکل name@example.com وارد کنید."
REGISTER_CONFLICT = "این حساب همین حالا ساخته شد. اگر خودتان بودید، وارد شوید."
UPDATE_CONFLICT = "این ایمیل یا شماره موبایل همین حالا برای حساب دیگری ثبت شد."
CURRENT_PASSWORD_REQUIRED = "برای تغییر ایمیل یا شماره موبایل، رمز عبور فعلی را وارد کنید."
CURRENT_PASSWORD_WRONG = "رمز عبور فعلی اشتباه است."
NEW_PASSWORD_SAME = "رمز عبور جدید باید با رمز فعلی فرق داشته باشد."
KEEP_EMAIL_OR_PHONE = "نمی‌توانید هم ایمیل و هم شماره موبایل را حذف کنید؛ دست‌کم یکی باید بماند."
STAFF_EMAIL_REQUIRED = "حساب مدیر باید ایمیل داشته باشد."

# Persian versions of Django's password validator messages, by error code
PASSWORD_MESSAGES = {
    "password_too_short": "رمز عبور باید دست‌کم {min_length} کاراکتر باشد.",
    "password_too_similar": "رمز عبور خیلی شبیه نام، ایمیل یا شماره موبایل شماست.",
    "password_too_common": "این رمز عبور خیلی رایج است و راحت حدس زده می‌شود.",
    "password_entirely_numeric": "رمز عبور نباید فقط عدد باشد.",
}
PASSWORD_REJECTED = "این رمز عبور پذیرفته نیست. رمز قوی‌تری انتخاب کنید."

_PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def required(message):
    # DRF's default messages are English; every case of an empty field gets this one
    return {"required": message, "blank": message, "null": message}


def name_field(message, too_long):
    # CharField trims spaces by default, so "   " counts as blank too
    return serializers.CharField(max_length=150, error_messages={**required(message), "max_length": too_long})


def email_field():
    # Optional, can be "" or null (= no email). Declared explicitly so ModelSerializer
    # doesn't add its own UniqueValidator with an English message.
    return serializers.EmailField(
        required=False, allow_blank=True, allow_null=True, max_length=254,
        error_messages={"invalid": EMAIL_INVALID, "max_length": EMAIL_INVALID},
    )


def phone_field():
    # Longer than the stored 11 digits, so formatted input (+98 912 ...) reaches clean_phone
    return serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=30)


def others(user):
    # Every account except this one (all accounts at sign-up), for uniqueness checks
    return Account.objects.exclude(pk=user.pk) if user else Account.objects.all()


def clean_email(value, user=None):
    """Normalized email or None; ValidationError if another account has it."""
    email = Account.objects.normalize_email(value)
    if email and others(user).filter(email=email).exists():
        raise serializers.ValidationError(EMAIL_TAKEN)
    return email


def clean_phone(value, user=None):
    """Normalized phone or None; ValidationError if invalid or another account has it."""
    if not (value or "").strip():
        return None
    try:
        phone = normalize_phone(value)
    except InvalidPhone as error:
        raise serializers.ValidationError(str(error))
    # Checked after normalizing, so +98912... and 0912... count as the same number
    if others(user).filter(phone=phone).exists():
        raise serializers.ValidationError(PHONE_TAKEN)
    return phone


def taken_errors(data, user=None):
    """After an IntegrityError: which of email/phone another account took meanwhile."""
    errors = {}
    if data.get('email') and others(user).filter(email=data['email']).exists():
        errors['email'] = [EMAIL_TAKEN]
    if data.get('phone') and others(user).filter(phone=data['phone']).exists():
        errors['phone'] = [PHONE_TAKEN]
    return errors


def persian_password_errors(error):
    """Turn Django's (English) password ValidationError into a list of Persian messages."""
    messages = []
    for item in error.error_list:
        template = PASSWORD_MESSAGES.get(item.code, PASSWORD_REJECTED)
        params = {key: str(value).translate(_PERSIAN_DIGITS) for key, value in (item.params or {}).items()}
        messages.append(template.format(**params))
    return messages


class AccountSerializer(serializers.ModelSerializer):
    """Info about a user (never includes the password)."""

    class Meta:
        model = Account
        # is_staff: the upload form asks admins for the store price instead of a seller share
        fields = ['id', 'first_name', 'last_name', 'email', 'phone', 'is_staff', 'date_joined']
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    first_name = name_field(FIRST_NAME_REQUIRED, "نام خیلی طولانی است.")
    last_name = name_field(LAST_NAME_REQUIRED, "نام خانوادگی خیلی طولانی است.")
    # Both optional here; validate() requires at least one of them
    email = email_field()
    phone = phone_field()
    # write_only so the password never shows up in a response
    password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}, error_messages=required("رمز عبور را وارد کنید.")
    )

    class Meta:
        model = Account
        fields = ['first_name', 'last_name', 'email', 'phone', 'password']

    def validate_email(self, value):
        return clean_email(value)

    def validate_phone(self, value):
        return clean_phone(value)

    def validate(self, attrs):
        if not attrs.get('email') and not attrs.get('phone'):
            raise serializers.ValidationError(EMAIL_OR_PHONE_REQUIRED)

        # Run Django's password validators against an unsaved user, so the
        # similarity check can compare the password with the name/email/phone.
        user = Account(
            first_name=attrs['first_name'], last_name=attrs['last_name'],
            email=attrs.get('email'), phone=attrs.get('phone'),
        )
        try:
            validate_password(attrs['password'], user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError({'password': persian_password_errors(error)})
        return attrs

    def create(self, validated_data):
        try:
            with transaction.atomic():
                # create_user hashes the password instead of saving it as plain text
                return Account.objects.create_user(**validated_data)
        except IntegrityError:
            # Two sign-ups with the same email/phone at the same moment both pass the
            # checks above; the unique constraint stops the second one here.
            raise serializers.ValidationError(taken_errors(validated_data) or [REGISTER_CONFLICT])


class AccountUpdateSerializer(serializers.ModelSerializer):
    """PATCH /accounts/me/: the user edits their own names, email and phone.

    Every field is optional (partial update). Changing email or phone, including
    adding or removing one, needs the current password: a stolen token alone must
    not be enough to take over the account's login. Names need no password.
    """

    first_name = name_field(FIRST_NAME_REQUIRED, "نام خیلی طولانی است.")
    last_name = name_field(LAST_NAME_REQUIRED, "نام خانوادگی خیلی طولانی است.")
    email = email_field()
    phone = phone_field()
    current_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, style={'input_type': 'password'}
    )

    class Meta:
        model = Account
        fields = ['first_name', 'last_name', 'email', 'phone', 'current_password']

    def validate_email(self, value):
        return clean_email(value, self.instance)

    def validate_phone(self, value):
        return clean_phone(value, self.instance)

    def validate(self, attrs):
        user = self.instance
        password = attrs.pop('current_password', '')
        email = attrs.get('email', user.email)
        phone = attrs.get('phone', user.phone)

        if email is None and phone is None:
            raise serializers.ValidationError(KEEP_EMAIL_OR_PHONE)
        # createsuperuser and the admin login rely on USERNAME_FIELD (email)
        if user.is_staff and email is None:
            raise serializers.ValidationError({'email': [STAFF_EMAIL_REQUIRED]})

        if (email, phone) != (user.email, user.phone):
            if not password:
                raise serializers.ValidationError({'current_password': [CURRENT_PASSWORD_REQUIRED]})
            if not user.check_password(password):
                raise serializers.ValidationError({'current_password': [CURRENT_PASSWORD_WRONG]})
        return attrs

    def update(self, instance, validated_data):
        try:
            with transaction.atomic():
                return super().update(instance, validated_data)
        except IntegrityError:
            # Another account took this email/phone between the check and the save
            raise serializers.ValidationError(taken_errors(validated_data, instance) or [UPDATE_CONFLICT])


class ChangePasswordSerializer(serializers.Serializer):
    """POST /accounts/me/password/: the current password, then the new one.

    The new password goes through the same Django validators (and Persian messages)
    as registration, including "too similar to your name, email or phone".
    """

    current_password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}, error_messages=required("رمز عبور فعلی را وارد کنید.")
    )
    new_password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}, error_messages=required("رمز عبور جدید را وارد کنید.")
    )

    def validate_current_password(self, value):
        if not self.context['user'].check_password(value):
            raise serializers.ValidationError(CURRENT_PASSWORD_WRONG)
        return value

    def validate_new_password(self, value):
        try:
            validate_password(value, user=self.context['user'])
        except DjangoValidationError as error:
            raise serializers.ValidationError(persian_password_errors(error))
        return value

    def validate(self, attrs):
        if attrs['new_password'] == attrs['current_password']:
            raise serializers.ValidationError({'new_password': [NEW_PASSWORD_SAME]})
        return attrs


class LoginSerializer(TokenObtainPairSerializer):
    """Takes identifier (email or phone) + password, returns access/refresh tokens and the user's info."""

    # simplejwt reads the credential from this field and passes it to
    # authenticate(identifier=...), which accounts.backends.IdentifierBackend handles.
    username_field = 'identifier'
    default_error_messages = {'no_active_account': LOGIN_FAILED}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['identifier'].error_messages.update(required("ایمیل یا شماره موبایل را وارد کنید."))
        self.fields['password'].error_messages.update(required("رمز عبور را وارد کنید."))

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = AccountSerializer(self.user).data
        return data
