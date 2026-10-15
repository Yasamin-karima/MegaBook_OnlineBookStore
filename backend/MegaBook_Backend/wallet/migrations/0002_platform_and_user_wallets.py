"""Data migration: MegaBook's platform wallet, and a wallet for every existing user.

Users created after this get theirs from the post_save signal (wallet/signals.py).
Migrations use the historical models from `apps`, not the real ones, so this keeps
working even after the models change later.
"""
from django.conf import settings
from django.db import migrations


def create_wallets(apps, schema_editor):
    Wallet = apps.get_model("wallet", "Wallet")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))

    Wallet.objects.get_or_create(kind="platform", owner=None)
    users_without_wallet = User.objects.filter(wallet__isnull=True)
    Wallet.objects.bulk_create([Wallet(kind="user", owner=user) for user in users_without_wallet])


def remove_wallets(apps, schema_editor):
    # Reversing this migration (migrate wallet 0001) removes only empty wallets;
    # a wallet with ledger entries is PROTECTed and stops the reversal.
    apps.get_model("wallet", "Wallet").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("wallet", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        # The latest accounts migration, so the user table is in its current shape
        ("accounts", "0003_account_names_not_blank"),
    ]

    operations = [
        migrations.RunPython(create_wallets, remove_wallets),
    ]
