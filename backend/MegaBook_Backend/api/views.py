from django.shortcuts import render
from rest_framework import generics
from accounts.models import account
from.serializers import AccountSerializer

# Create your views here.
class AccountAPIView(generics.ListAPIView):
    queryset = account.objects.all()
    serializer_class = AccountSerializer
