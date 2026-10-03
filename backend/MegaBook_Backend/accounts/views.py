from django.contrib.auth import get_user_model
from django.views.generic import ListView
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import AccountSerializer, LoginSerializer, RegisterSerializer

Account = get_user_model()


def tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {'access': str(refresh.access_token), 'refresh': str(refresh)}


class RegisterView(generics.CreateAPIView):
    """POST username, email, password -> creates the account and logs the user in."""
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
    """POST username, password -> access + refresh tokens and user info."""
    serializer_class = LoginSerializer


class MeView(generics.RetrieveAPIView):
    """GET the currently logged-in user (needs 'Authorization: Bearer <access>')."""
    serializer_class = AccountSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class AccountListView(ListView):
    model = Account
    template_name = 'accounts/account_list.html'
