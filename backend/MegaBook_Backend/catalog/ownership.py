"""Which books a user "owns": the only place this is defined.

A user owns a book they can read and must not buy:
  - books they uploaded themselves;
  - books in their library (bought at checkout).

`is_owned` in the public book API, the cart's "can't add" rule, the cart's
automatic clean-up, checkout and Book.can_download_file all ask these functions.
"""
from django.db.models import BooleanField, Case, Exists, OuterRef, Q, Value, When


def owned_q(user):
    """A Q for Book querysets: the books this user owns.

    Exists(...) rather than Q(library_items__user=user): inside annotate/CASE the
    latter JOINs the library table, and each book would appear once per buyer.
    """
    from library.models import LibraryItem

    in_library = LibraryItem.objects.filter(user=user, book=OuterRef("pk"))
    return Q(uploaded_by=user) | Q(Exists(in_library))


def owned_book_ids(user, book_ids=None):
    """IDs of the books this user owns, optionally only among `book_ids`."""
    from .models import Book

    if user is None or not user.is_authenticated:
        return set()
    queryset = Book.objects.filter(owned_q(user))
    if book_ids is not None:
        queryset = queryset.filter(pk__in=book_ids)
    return set(queryset.values_list("pk", flat=True))


def annotate_is_owned(queryset, user):
    """Adds `is_owned` to every book in the queryset with one SQL CASE, not a query per book."""
    if user is None or not user.is_authenticated:
        return queryset.annotate(is_owned=Value(False, output_field=BooleanField()))
    return queryset.annotate(
        is_owned=Case(When(owned_q(user), then=Value(True)), default=Value(False), output_field=BooleanField())
    )
