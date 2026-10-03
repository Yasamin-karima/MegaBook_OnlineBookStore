from django.contrib.auth.models import AbstractUser
from django.db import models


class Account(AbstractUser):
    # AbstractUser already gives us username, password (stored hashed),
    # first/last name, is_active, is_staff, date_joined, last_login, ...
    # We only override email to make it required and unique.
    email = models.EmailField(unique=True)

    def __str__(self):
        return self.username
