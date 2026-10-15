from asgiref.sync import sync_to_async
from django.contrib.auth import check_password_with_timing_attack_mitigation, get_user_model
from django.contrib.auth.backends import ModelBackend
from django.views.decorators.debug import sensitive_variables

from .phone import InvalidPhone, normalize_phone

UserModel = get_user_model()


class IdentifierBackend(ModelBackend):
    """Log in with one identifier (email or mobile number) and a password.

    An identifier containing "@" is an email; anything else is a phone number.
    Both are normalized exactly as they are when saved, so "+98 912..." finds
    the user stored as "0912...".

    Inherits from ModelBackend, so permissions (has_perm, ...) and the
    "inactive users can't log in" rule (user_can_authenticate) stay the same.
    """

    @sensitive_variables("password")
    def authenticate(self, request, identifier=None, password=None, username=None, **kwargs):
        # Django admin's login form passes the identifier as `username`
        if identifier is None:
            identifier = username if username is not None else kwargs.get(UserModel.USERNAME_FIELD)
        if identifier is None or password is None:
            return None

        user = self.find_user(identifier)
        # With no user, this still hashes the password, so "no such account" takes
        # as long as "wrong password" and response times don't reveal which
        # emails or phone numbers have accounts.
        if check_password_with_timing_attack_mitigation(user, password) and self.user_can_authenticate(user):
            return user
        return None

    async def aauthenticate(self, request, identifier=None, password=None, username=None, **kwargs):
        return await sync_to_async(self.authenticate)(
            request, identifier=identifier, password=password, username=username, **kwargs
        )

    def find_user(self, identifier):
        """The user with this email or phone, or None (including for an invalid phone)."""
        manager = UserModel._default_manager
        identifier = str(identifier).strip()
        if "@" in identifier:
            lookup = {"email": manager.normalize_email(identifier)}
        else:
            try:
                lookup = {"phone": normalize_phone(identifier)}
            except InvalidPhone:
                return None
        try:
            return manager.get(**lookup)
        except UserModel.DoesNotExist:
            return None
