"""Creating and reading notifications. notify() is the ONLY way a notification is made.

Called explicitly right where each event happens (no Django signals), inside that
event's transaction: if the event is rolled back, so is its notification. Each call
site sits on the one path every change takes (the model's save() or a service
function), so changes made in the Django admin notify exactly like the API does,
and only when the status actually changes.
"""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .models import Notification, retention_cutoff

Type = Notification.Type

# Pass as `recipients` to notify every active admin (each gets their own copy)
STAFF = "staff"


def notify(type, recipients, *, params=None, **sources):
    """Create one notification of `type` for each recipient.

    recipients: STAFF, or an iterable of users, or of (user, {source: obj}) pairs
    when each recipient has their own source (e.g. their own RequestEntry).
    params: the snapshot texts.py needs (title, reason, amount, ...).
    sources: the foreign keys shared by all of them (book=..., conversation=...).

    For conversation types, an unread one for the same conversation is not duplicated
    (the partial unique constraint, with ON CONFLICT DO NOTHING).
    """
    if not transaction.get_connection().in_atomic_block:
        # The notification must live and die with its event
        raise RuntimeError("notify() must run inside the event's transaction.atomic().")
    if recipients == STAFF:
        recipients = get_user_model().objects.filter(is_staff=True, is_active=True)

    rows = []
    for recipient in recipients:
        own_sources = {}
        if isinstance(recipient, tuple):
            recipient, own_sources = recipient
        rows.append(Notification(recipient=recipient, type=type, params=params or {}, **sources, **own_sources))
    Notification.objects.bulk_create(rows, ignore_conflicts=type in Notification.CONVERSATION_TYPES)


def mark_conversation_read(user, conversation, type=None):
    """The user has opened (or written in) a conversation: its notification is read.
    Only this user's; another admin's copy stays unread."""
    if user is None or conversation is None:
        return
    queryset = Notification.objects.filter(recipient=user, conversation=conversation, read_at__isnull=True)
    if type is not None:
        queryset = queryset.filter(type=type)
    queryset.update(read_at=timezone.now())


def visible_to(user):
    """The notifications the API may show this user: their own, from the last 90 days."""
    return Notification.objects.filter(recipient=user).recent()


def purge_old(user=None):
    """Delete notifications older than the retention period (one user's, or everyone's).
    Returns how many were deleted."""
    queryset = Notification.objects.filter(created_at__lt=retention_cutoff())
    if user is not None:
        queryset = queryset.filter(recipient=user)
    deleted, _ = queryset.delete()
    return deleted
