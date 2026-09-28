from rest_framework import serializers
from accounts.models import account

class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = account
        fields = ('username', 'email')