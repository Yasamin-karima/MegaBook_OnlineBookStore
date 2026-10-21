from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from book_requests.models import BookRequest, RequestEntry
from cart import services as cart_services
from catalog.models import Book
from orders import services as order_services
from wallet import services as wallet_services
from wallet.models import LedgerEntry
from wallet.tests import VALID_CARD

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"


def make_user(**fields):
    return User.objects.create_user(first_name="سارا", last_name="احمدی", password=PASSWORD, **fields)


class BookFactory:
    counter = 0

    @classmethod
    def make(cls, uploader, price=50_000, share=0, book_status=Book.Status.APPROVED):
        cls.counter += 1
        return Book.objects.create(
            title=f"کتاب {cls.counter}", isbn=f"977{cls.counter:010d}", status=book_status,
            price=price, seller_share=share, uploaded_by=uploader, book_file="books/files/x.pdf",
        )


class DashboardTests(APITestCase):
    url = reverse("dashboard")

    def get(self, user):
        self.client.force_authenticate(user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_anonymous_rejected(self):
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_email_only_user_with_nothing_yet(self):
        data = self.get(make_user(email="sara@example.com"))
        self.assertEqual(data["user"], {
            "first_name": "سارا", "last_name": "احمدی", "email": "sara@example.com", "phone": None,
        })
        self.assertEqual(data["wallet"], {"balance": 0})
        self.assertEqual(data["cart"], {"count": 0, "total": 0})
        self.assertEqual(data["requests"], {"open": 0, "fulfilled": 0, "rejected": 0})
        self.assertEqual(data["uploads"], {
            "pending": 0, "approved": 0, "rejected": 0, "sales": 0, "earnings": 0,
        })

    def test_phone_only_user(self):
        data = self.get(make_user(phone="09121234567"))
        self.assertEqual((data["user"]["email"], data["user"]["phone"]), (None, "09121234567"))

    def test_seller_with_sales_matches_the_ledger(self):
        admin = User.objects.create_superuser(email="admin@example.com", first_name="a", last_name="b", password=PASSWORD)
        seller = make_user(email="seller@example.com")
        buyer = make_user(email="buyer@example.com")
        wallet_services.adjust(wallet_services.wallet_of(buyer), 200_000, "شارژ", admin)

        sold = BookFactory.make(seller, price=80_000, share=60_000)
        also_sold = BookFactory.make(seller, price=50_000, share=40_000)
        free = BookFactory.make(seller, price=0)
        BookFactory.make(seller, price=None, book_status=Book.Status.PENDING)
        BookFactory.make(seller, price=None, book_status=Book.Status.REJECTED)
        for book in (sold, also_sold, free):
            cart_services.add(buyer, book.pk)
        order_services.checkout(buyer)
        # The admin then changes a price: earnings still follow the ledger, not the book
        sold.price, sold.seller_share = 100_000, 90_000
        sold.save()
        # A withdrawal lowers the balance but not the earnings
        wallet_services.create_withdrawal(seller, 30_000, VALID_CARD)

        uploads = self.get(seller)["uploads"]
        ledger_income = sum(
            LedgerEntry.objects.filter(wallet__owner=seller, type="sale_income").values_list("amount", flat=True)
        )
        self.assertEqual(ledger_income, 100_000)
        self.assertEqual(uploads, {
            "pending": 1, "approved": 3, "rejected": 1, "sales": 3, "earnings": ledger_income,
        })
        self.assertEqual(self.get(seller)["wallet"]["balance"], 70_000)
        self.assertEqual(self.get(buyer)["wallet"]["balance"], 70_000)

    def test_requests_and_cart(self):
        user = make_user(email="sara@example.com")
        seller = make_user(email="seller@example.com")
        for i, request_status in enumerate(["open", "open", "fulfilled", "rejected"]):
            book_request = BookRequest.objects.create(
                isbn=f"97800000000{i:02d}", title="x", status=request_status,
                rejection_reason="ناموجود" if request_status == "rejected" else "",
            )
            RequestEntry.objects.create(request=book_request, requester=user)
        # Someone else's request isn't counted
        RequestEntry.objects.create(request=BookRequest.objects.first(), requester=seller)

        ok = BookFactory.make(seller, price=30_000)
        gone = BookFactory.make(seller, price=20_000)
        for book in (ok, gone):
            cart_services.add(user, book.pk)
        gone.status = Book.Status.REJECTED
        gone.save()

        data = self.get(user)
        self.assertEqual(data["requests"], {"open": 2, "fulfilled": 1, "rejected": 1})
        # Like the cart page: the unavailable book is counted but not in the total
        self.assertEqual(data["cart"], {"count": 2, "total": 30_000})

    def test_query_count_does_not_grow(self):
        user = make_user(email="sara@example.com")
        seller = make_user(email="seller@example.com")
        for _ in range(5):
            cart_services.add(user, BookFactory.make(seller, price=0).pk)
            BookFactory.make(user, price=None, book_status=Book.Status.PENDING)
        self.client.force_authenticate(user)
        # ledger, cart, requests, uploads, sales (+1 for the JWT user lookup in real requests)
        with self.assertNumQueries(5):
            self.client.get(self.url)
