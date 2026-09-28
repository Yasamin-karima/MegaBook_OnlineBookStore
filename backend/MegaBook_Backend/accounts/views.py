from django.shortcuts import render
from rest_framework import generics, permissions
from .serializers import RegisterSerializer
from django.views.generic import ListView
from .models import account

class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny] 


class AccountListView(ListView):
    model = account
    template_name = 'account_list.html'