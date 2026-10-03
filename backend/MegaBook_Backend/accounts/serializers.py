from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

Account = get_user_model()


class AccountSerializer(serializers.ModelSerializer):
    """Public info about a user (never includes the password)."""

    class Meta:
        model = Account
        fields = ['id', 'username', 'email', 'date_joined']
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    # write_only so the password never shows up in a response
    password = serializers.CharField(write_only=True, style={'input_type': 'password'})

    class Meta:
        model = Account
        fields = ['username', 'email', 'password']

    def validate_email(self, value):
        value = value.strip().lower()
        if Account.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def validate(self, attrs):
        # Run Django's password validators against an unsaved user, so the
        # similarity check can compare the password with the username/email.
        user = Account(username=attrs['username'], email=attrs['email'])
        try:
            validate_password(attrs['password'], user=user)
        except DjangoValidationError as e:
            raise serializers.ValidationError({'password': list(e.messages)})
        return attrs

    def create(self, validated_data):
        # create_user hashes the password instead of saving it as plain text
        return Account.objects.create_user(**validated_data)


class LoginSerializer(TokenObtainPairSerializer):
    """Takes username + password, returns access/refresh tokens plus the user's info."""

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = AccountSerializer(self.user).data
        return data
