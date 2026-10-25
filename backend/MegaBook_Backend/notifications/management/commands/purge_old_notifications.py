"""Delete every notification older than the retention period (90 days).

The API never returns them anyway, and each user's old ones are deleted when they open
their list; this cleans up everyone else's. Safe to run any time, by hand or by cron:

    python manage.py purge_old_notifications
"""
from django.core.management.base import BaseCommand

from notifications.models import RETENTION_DAYS
from notifications.services import purge_old


class Command(BaseCommand):
    help = f"Delete notifications older than {RETENTION_DAYS} days."

    def handle(self, *args, **options):
        deleted = purge_old()
        self.stdout.write(self.style.SUCCESS(f"{deleted} notification(s) older than {RETENTION_DAYS} days deleted."))
