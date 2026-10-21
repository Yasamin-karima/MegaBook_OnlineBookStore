from django.conf import settings
from django.db import models

from catalog.models import Book


class CartItem(models.Model):
    """One book in one user's cart.

    There is no Cart model: each user has exactly one cart, so "the user's cart"
    is simply their CartItem rows (user.cart_items). A Cart table would add a row
    per user that must be created and kept unique, and a join to every query,
    without holding any information of its own.

    No quantity: an ebook is either in the cart or not.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cart_items")
    # CASCADE: a cart is not a record of anything. If the book is deleted, its cart
    # rows go too (orders, which ARE records, will PROTECT their books instead).
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="cart_items")
    # The price the user saw when adding, always copied by the SERVER from the book,
    # never sent by the frontend. Only used to warn "the price changed"; money is
    # always taken at the book's current price.
    price_seen = models.PositiveIntegerField()
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["added_at", "id"]
        constraints = [
            # A book is in a cart at most once; a double-click can't add it twice
            models.UniqueConstraint(fields=["user", "book"], name="cart_one_item_per_book"),
        ]

    def __str__(self):
        return f"{self.book} ({self.user})"
