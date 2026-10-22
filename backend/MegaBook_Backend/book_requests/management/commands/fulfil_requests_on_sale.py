"""Fulfil open requests whose book is already on sale (data from before DECISIONS 5.14).

Since 5.14 this happens by itself when a book is approved. This command fixes requests
that were left open before that. Each request is saved through BookRequest.save(), so
its requesters get the usual system message and their conversations close.
Nothing is deleted. Safe to run again: a second run finds nothing to do.

    python manage.py fulfil_requests_on_sale --dry-run   # only list them
    python manage.py fulfil_requests_on_sale
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from book_requests.models import BookRequest
from book_requests.services import open_requests_already_on_sale


class Command(BaseCommand):
    help = "Mark open requests as fulfilled when an approved book with the same ISBN exists."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only list the requests; change nothing.")

    def handle(self, *args, dry_run=False, **options):
        requests = list(open_requests_already_on_sale().order_by("pk"))
        for book_request in requests:
            self.stdout.write(f"{book_request.isbn}  {book_request.title}")
        if dry_run:
            self.stdout.write(self.style.WARNING(f"{len(requests)} request(s) would be fulfilled (dry run)."))
            return
        for book_request in requests:
            with transaction.atomic():
                book_request.status = BookRequest.Status.FULFILLED
                book_request.save()
        self.stdout.write(self.style.SUCCESS(f"{len(requests)} request(s) fulfilled."))
