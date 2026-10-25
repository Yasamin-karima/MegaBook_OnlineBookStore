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
            rejection_reason="دلیل نمونه" if book_status == Book.Status.REJECTED else "",
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
        gone.rejection_reason = "فایل ناقص"
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


# ---------------------------------------------------------------------------
# "My Requests & Uploads"
# ---------------------------------------------------------------------------

from support import services as support_services  # noqa: E402


class TrackingListTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email="admin@example.com", first_name="a", last_name="b", password=PASSWORD
        )
        self.a = make_user(email="ali@example.com")
        self.b = make_user(email="bita@example.com")
        self.client.force_authenticate(self.a)

    def request(self, user, isbn, title="کتاب", status=BookRequest.Status.OPEN, reason=""):
        book_request, _ = BookRequest.objects.get_or_create(isbn=isbn, defaults={"title": title})
        entry = RequestEntry.objects.create(request=book_request, requester=user)
        if status != book_request.status:
            book_request.status, book_request.rejection_reason = status, reason
            book_request.save()
        return entry

    def get(self, name, **params):
        response = self.client.get(reverse(name), params)
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_counts_match_the_dashboard_for_every_status(self):
        self.request(self.a, "9780000000101", status=BookRequest.Status.OPEN)
        self.request(self.a, "9780000000102", status=BookRequest.Status.OPEN)
        self.request(self.a, "9780000000103", status=BookRequest.Status.FULFILLED)
        self.request(self.a, "9780000000104", status=BookRequest.Status.REJECTED, reason="حق نشر")
        self.request(self.b, "9780000000105")  # someone else's
        BookFactory.make(self.a, price=None, book_status=Book.Status.PENDING)
        BookFactory.make(self.a)
        BookFactory.make(self.a)
        BookFactory.make(self.a, price=None, book_status=Book.Status.REJECTED)

        dashboard = self.get("dashboard")
        self.assertEqual(dashboard["requests"], {"open": 2, "fulfilled": 1, "rejected": 1})
        for key, n in dashboard["requests"].items():
            self.assertEqual(self.get("my_requests", status=key)["count"], n, key)
        for key in ("pending", "approved", "rejected"):
            self.assertEqual(self.get("my_uploads_tracking", status=key)["count"], dashboard["uploads"][key], key)
        self.assertEqual(self.get("my_requests")["count"], 4)
        self.assertEqual(self.get("my_uploads_tracking")["count"], 4)

    def test_only_my_items_even_for_the_same_isbn(self):
        mine = self.request(self.a, "9780000000201", title="مشترک")
        theirs = self.request(self.b, "9780000000201")
        BookFactory.make(self.b)
        support_services.post_user_message(self.b, theirs, "پیام بیتا")
        items = self.get("my_requests")["results"]
        self.assertEqual([i["id"] for i in items], [mine.pk])
        self.assertIsNone(items[0]["last_message"])
        self.assertEqual(self.get("my_uploads_tracking")["count"], 0)
        body = self.client.get(reverse("my_requests")).content.decode()
        self.assertNotIn("bita@example.com", body)
        self.assertNotIn("requester", body)

    def test_unread_badge_and_reading(self):
        entry = self.request(self.a, "9780000000301")
        support_services.post_support_message(self.admin, entry, "سلام")
        support_services.post_support_message(self.admin, entry, "پاسخ دوم")
        item = self.get("my_requests")["results"][0]
        self.assertEqual(item["unread_count"], 2)
        self.assertEqual(item["last_message"], {"sender": "support", "text": "پاسخ دوم"})
        self.client.post(f"/support/requests/{entry.pk}/read/")
        self.assertEqual(self.get("my_requests")["results"][0]["unread_count"], 0)

    def test_fulfilled_request_links_to_the_store_book_and_closes(self):
        entry = self.request(self.a, "9770000000999", status=BookRequest.Status.FULFILLED)
        store_book = Book.objects.create(
            title="x", isbn="9770000000999", status=Book.Status.APPROVED, price=0,
            uploaded_by=self.admin, book_file="books/files/x.pdf",
        )
        item = self.get("my_requests")["results"][0]
        self.assertEqual((item["id"], item["book_id"], item["conversation_closed"]), (entry.pk, store_book.pk, True))

    def test_upload_sales_and_earnings_match_the_ledger(self):
        buyer = make_user(email="buyer@example.com")
        wallet_services.adjust(wallet_services.wallet_of(buyer), 100_000, "شارژ", self.admin)
        sold = BookFactory.make(self.a, price=40_000, share=30_000)
        other = BookFactory.make(self.a, price=20_000, share=10_000)
        free = BookFactory.make(self.a, price=0)
        for book in (sold, other, free):
            cart_services.add(buyer, book.pk)
        order_services.checkout(buyer)
        pending = BookFactory.make(self.a, price=None, book_status=Book.Status.PENDING)

        rows = {i["id"]: i for i in self.get("my_uploads_tracking")["results"]}
        for book in (sold, other, free):
            ledger = sum(LedgerEntry.objects.filter(
                wallet__owner=self.a, type="sale_income", order_item__book=book
            ).values_list("amount", flat=True))
            self.assertEqual((rows[book.pk]["sales_count"], rows[book.pk]["earnings"]), (1, ledger))
            self.assertEqual(rows[book.pk]["book_id"], book.pk)
        self.assertEqual(rows[sold.pk]["earnings"], 30_000)
        self.assertEqual(
            (rows[pending.pk]["sales_count"], rows[pending.pk]["earnings"], rows[pending.pk]["book_id"]),
            (None, None, None),
        )

    def test_no_book_file_or_download_address(self):
        BookFactory.make(self.a)
        body = self.client.get(reverse("my_uploads_tracking")).content.decode()
        for forbidden in ("book_file", "books/files", "file-link", "/file/", "seller_share"):
            self.assertNotIn(forbidden, body)

    def test_search_and_status_filter(self):
        self.request(self.a, "9780000000401", title="سمفونی مردگان")
        self.request(self.a, "9780000000402", title="بوف کور")
        self.assertEqual(self.get("my_requests", search="سمفونی")["count"], 1)
        self.assertEqual(self.get("my_requests", search="۹۷۸-۰۰۰۰۰۰۰۴۰۲")["results"][0]["title"], "بوف کور")
        Book.objects.create(title="جزوهٔ جبر", isbn="9770000000555", status=Book.Status.PENDING,
                            uploaded_by=self.a, book_file="books/files/x.pdf")
        self.assertEqual(self.get("my_uploads_tracking", search="جبر")["count"], 1)
        self.assertEqual(self.get("my_uploads_tracking", search="9770000000555")["count"], 1)
        self.assertEqual(self.get("my_uploads_tracking", status="approved")["count"], 0)

    def test_get_only_and_login_required(self):
        entry = self.request(self.a, "9780000000501")
        for name in ("my_requests", "my_uploads_tracking"):
            for method in ("post", "put", "patch", "delete"):
                response = getattr(self.client, method)(reverse(name))
                self.assertEqual(response.status_code, 405, (name, method))
        # No other endpoint withdraws a request either
        self.assertEqual(self.client.delete(f"/book-requests/{entry.request_id}/join/").status_code, 405)
        self.assertEqual(self.client.delete("/book-requests/").status_code, 405)
        self.assertTrue(RequestEntry.objects.filter(pk=entry.pk).exists())
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("my_requests")).status_code, 401)

    def test_query_counts(self):
        for i in range(6):
            entry = self.request(self.a, f"97800000006{i:02d}")
            support_services.post_support_message(self.admin, entry, "پیام")
            BookFactory.make(self.a)
        with self.assertNumQueries(2):
            self.client.get(reverse("my_requests"))
        with self.assertNumQueries(3):
            self.client.get(reverse("my_uploads_tracking"))


class UploaderReadingTests(APITestCase):
    def setUp(self):
        self.uploader = make_user(email="up@example.com")
        self.stranger = make_user(email="other@example.com")

    def link(self, user, book):
        self.client.force_authenticate(user)
        return self.client.get(reverse("book_file_link", args=[book.pk])).status_code

    def test_uploader_reads_only_approved_and_strangers_never(self):
        book = BookFactory.make(self.uploader)
        self.assertEqual(self.link(self.uploader, book), 200)
        self.assertEqual(self.link(self.stranger, book), 404)
        self.client.force_authenticate(self.uploader)
        self.assertTrue(self.client.get(reverse("book_detail", args=[book.pk])).data["is_owned"])
        for blocked in (Book.Status.PENDING, Book.Status.REJECTED):
            book.status = blocked
            book.save()
            self.assertEqual(self.link(self.uploader, book), 404, blocked)
            self.client.force_authenticate(self.uploader)
            self.assertEqual(self.client.get(reverse("book_detail", args=[book.pk])).status_code, 404)


class AdminRequestEntryReadOnlyTests(APITestCase):
    def test_admin_cannot_delete_request_entries_or_requests(self):
        from django.contrib.admin.sites import site

        model_admin = site._registry[RequestEntry]
        self.assertFalse(model_admin.has_delete_permission(None))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertFalse(site._registry[BookRequest].has_delete_permission(None))
