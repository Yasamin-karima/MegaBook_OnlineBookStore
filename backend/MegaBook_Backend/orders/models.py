"""Orders: the receipt of a purchase (DECISIONS 10).

An Order is the receipt header (who, when); each OrderItem is one line (which
book, at what price). Only orders/services.checkout creates them, and they never
change afterwards: a purchase is a historical fact, like a ledger entry.
"""
from django.conf import settings
from django.db import models
from django.db.models import F, Q

from catalog.models import Book


class ImmutableOrderError(Exception):
    """Raised on any attempt to change or remove an order or an order item."""


class ImmutableQuerySet(models.QuerySet):
    # Bulk changes skip Model.save()/delete(), so they are blocked here too
    def update(self, **kwargs):
        raise ImmutableOrderError("Orders can't be changed after the purchase.")

    def delete(self):
        raise ImmutableOrderError("Orders can't be deleted.")


class ImmutableModel(models.Model):
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableOrderError("Orders can't be changed after the purchase.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ImmutableOrderError("Orders can't be deleted.")


class Order(ImmutableModel):
    """One checkout.

    No status: payment is from the wallet inside the same database transaction that
    creates the order, so an order either exists complete (paid) or doesn't exist.
    No stored total: it's always the sum of the items' prices (DECISIONS 3.6).
    """

    # PROTECT: someone who bought something is part of the financial history (DECISIONS 3.9)
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"سفارش {self.pk} ({self.buyer})"

    @property
    def total(self):
        """Sum of the items (uses prefetched items when there are any)."""
        return sum(item.price for item in self.items.all())


class OrderItem(ImmutableModel):
    """One book in one order, with the money as it was AT THE MOMENT OF PURCHASE.

    price and seller_share are snapshots, not copies to keep in sync: if the admin
    changes the book's price later, this line must still show what was paid. The
    commission is not stored: it's price - seller_share.
    """

    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="items")
    # PROTECT: a book that has been sold can never be deleted
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="order_items")
    price = models.PositiveIntegerField()
    seller_share = models.PositiveIntegerField()

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "book"], name="order_one_line_per_book"),
            models.CheckConstraint(condition=Q(price__gte=F("seller_share")), name="order_item_price_covers_share"),
        ]

    def __str__(self):
        return f"{self.book} ({self.price:,} تومان)"

    @property
    def commission(self):
        return self.price - self.seller_share
