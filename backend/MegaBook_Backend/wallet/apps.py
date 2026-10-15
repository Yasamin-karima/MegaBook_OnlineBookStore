from django.apps import AppConfig


class WalletConfig(AppConfig):
    name = 'wallet'

    def ready(self):
        # Connects the post_save receiver that gives every new user a wallet
        from . import signals  # noqa: F401
