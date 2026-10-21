from django.conf import settings
from django.db import models

from catalog.models import Book


class LibraryItem(models.Model):
    """A book a user may read because they got it (bought; later perhaps a gift).

    Separate from OrderItem so that "does this user have this book?" has one table
    and one unique constraint (catalog/ownership.py asks it), whatever the source.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="library_items")
    # PROTECT: a book in someone's library can't be deleted; it stays readable even
    # if it's later taken off the store
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="library_items")
    # Where it came from; optional so a book can later be granted without a fake order
    order_item = models.OneToOneField(
        "orders.OrderItem", on_delete=models.PROTECT, null=True, blank=True, related_name="library_item"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            # The database-level guarantee that nobody gets (and pays for) a book twice,
            # even if two checkouts slip past every check in the code
            models.UniqueConstraint(fields=["user", "book"], name="library_one_copy_per_user"),
        ]

    def __str__(self):
        return f"{self.book} ({self.user})"
