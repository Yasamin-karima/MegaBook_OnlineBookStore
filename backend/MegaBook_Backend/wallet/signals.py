from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from . import services


# Every user gets a wallet however they're created: registration (create_user),
# createsuperuser, seed_books (get_or_create), the admin's add form. All of them end
# in Model.save(), which sends post_save; the manager alone would miss the last two.
# A signal (not code in Account.save) keeps the dependency one-way: wallet knows
# about accounts, accounts doesn't know about wallet.
@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_wallet_for_new_user(sender, instance, created, raw=False, **kwargs):
    # raw: loading fixtures (loaddata); wallets come from the fixture itself
    if created and not raw:
        services.ensure_user_wallet(instance)
