from django.contrib.auth import get_user_model
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import AccountSerializer, AccountUpdateSerializer, LoginSerializer, RegisterSerializer

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
