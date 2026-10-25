from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from book_requests.models import BookRequest, RequestEntry
from cart import services as cart_services
from catalog.models import Book, Person
from orders import services as order_services
from reviews.models import Review
from wallet import services as wallet_services
from wallet.models import TopUpRequest

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"


class Make:
    """Small factories for the admin API tests. Every row goes through the models'
    own save() (or the services), like the real code paths."""

    counter = 0

    @classmethod
    def next(cls):
        cls.counter += 1
        return cls.counter

    @classmethod
    def user(cls, name=None, **extra):
        n = cls.next()
        name = name or f"user{n}"
        return User.objects.create_user(
            email=f"{name}@example.com", first_name=name, last_name="تست", password=PASSWORD, **extra
        )

    @classmethod
    def admin(cls, name="admin"):
        return User.objects.create_superuser(
            email=f"{name}@example.com", first_name=name, last_name="مدیر", password=PASSWORD
        )

    @classmethod
    def book(cls, uploader, book_status=Book.Status.PENDING, price=None, seller_share=0, isbn=None, **extra):
        n = cls.next()
        if book_status == Book.Status.REJECTED:
            extra.setdefault("rejection_reason", "فایل ناقص")
        book = Book.objects.create(
            title=f"کتاب {n}", isbn=isbn or f"974{n:010d}", status=book_status, price=price,
            seller_share=seller_share, uploaded_by=uploader, book_file="books/files/x.pdf", **extra,
        )
        book.authors.add(Person.objects.get_or_create(name="نویسنده")[0])
        return book

    @classmethod
    def request(cls, *users, isbn=None, **fields):
        n = cls.next()
        book_request = BookRequest.objects.create(
            isbn=isbn or f"973{n:010d}", title=f"درخواست {n}", authors="نویسنده", **fields
        )
        entries = [RequestEntry.objects.create(request=book_request, requester=u) for u in users]
        return book_request, entries

    @classmethod
    def topup(cls, user, amount=50_000):
        n = cls.next()
        return TopUpRequest.objects.create(
            user=user, amount=amount, tracking_number=f"TR{n:06d}", deposited_at=timezone.now() - timedelta(hours=1)
        )

    @classmethod
    def fund(cls, user, amount, admin):
        wallet_services.adjust(wallet_services.wallet_of(user), amount, "شارژ آزمایشی", admin)

    @classmethod
    def sale(cls, buyer, book, admin):
        """A real checkout of one book (order, ledger legs, library)."""
        if book.price:
            cls.fund(buyer, book.price, admin)
        cart_services.add(buyer, book.pk)
        return order_services.checkout(buyer)

    @classmethod
    def review(cls, user, book, body="متن نظر", rating=4):
        return Review.objects.create(user=user, book=book, rating=rating, body=body)


def balance(user):
    return wallet_services.balance_of(wallet_services.wallet_of(user))


class AdminApiTestCase(APITestCase):
    def setUp(self):
        self.admin = Make.admin()
        self.client.force_authenticate(self.admin)
