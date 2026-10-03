from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Account

# UserAdmin gives the proper user admin page (hashed passwords, change-password form, etc.)
admin.site.register(Account, UserAdmin)
