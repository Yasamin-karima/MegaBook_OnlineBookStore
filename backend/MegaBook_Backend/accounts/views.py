from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    AccountSerializer,
    AccountUpdateSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    RegisterSerializer,
)

Account = get_user_model()


def tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {'access': str(refresh.access_token), 'refresh': str(refresh)}


class RegisterView(generics.CreateAPIView):
    """POST first_name, last_name, email and/or phone, password -> creates the account and logs the user in."""
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    # ignore any (possibly expired) token the browser still sends, like the login view does
    authentication_classes = []

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {'user': AccountSerializer(user).data, **tokens_for(user)},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    """POST identifier (email or phone), password -> access + refresh tokens and user info."""
    serializer_class = LoginSerializer


class MeView(generics.RetrieveUpdateAPIView):
    """
    The currently logged-in user (needs 'Authorization: Bearer <access>').
    GET   -> the user's info
    PATCH -> edit first_name, last_name, email, phone (see AccountUpdateSerializer);
             changing email or phone also needs current_password. Returns the updated user.
    """
    permission_classes = [permissions.IsAuthenticated]
    # No PUT: every field is optional, so only partial updates make sense
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_serializer_class(self):
        if self.request.method == 'PATCH':
            return AccountUpdateSerializer
        return AccountSerializer

    def get_object(self):
        return self.request.user

    def update(self, request, *args, **kwargs):
        serializer = AccountUpdateSerializer(self.get_object(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # The same shape as GET, so the client can replace what it shows
        return Response(AccountSerializer(user).data)


class ChangePasswordView(APIView):
    """
    POST /accounts/me/password/ { current_password, new_password }
    -> 200 { access, refresh }: new tokens for THIS device.

    Every refresh token issued before is blacklisted, so every other device (a
    stolen token included) is logged out within one access-token lifetime: access
    tokens are stateless and stay valid until they expire (ACCESS_TOKEN_LIFETIME).
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        serializer = ChangePasswordSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user.set_password(serializer.validated_data['new_password'])
            user.save(update_fields=['password'])
            # The blacklist app records every refresh token it issues (OutstandingToken)
            for token in OutstandingToken.objects.filter(user=user):
                BlacklistedToken.objects.get_or_create(token=token)
        return Response(tokens_for(user))
