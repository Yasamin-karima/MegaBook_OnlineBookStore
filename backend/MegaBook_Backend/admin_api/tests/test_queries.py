"""No N+1: every list endpoint runs a fixed number of queries, however many rows."""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from catalog.models import Book
from support import services as support
from wallet import services as wallet_services

from .helpers import AdminApiTestCase, Make

# The expected number of queries for one page of each list
EXPECTED = {
    "/admin-api/books/?status=all": 3,          # count, page, pending_count
    "/admin-api/book-requests/?filter=all": 3,  # count, page, new_count
    "/admin-api/conversations/?filter=all": 3,  # count, page, waiting_count
    "/admin-api/wallet/topups/?status=all": 4,  # count, page, 2 pending counts
    "/admin-api/wallet/withdrawals/?status=all": 4,
    "/admin-api/wallet/adjustments/": 2,
    "/admin-api/reviews/?filter=all": 3,        # count, page, new_count
    "/admin-api/users/": 2,
    "/admin-api/categories/": 1,
    "/admin-api/tags/": 1,
    "/admin-api/counts/": 6,
}


class QueryCountTests(AdminApiTestCase):
    def add_rows(self, n):
        """n more rows in every list (each with its own user, messages and money)."""
        for _ in range(n):
            user, seller = Make.user(), Make.user()
            book = Make.book(seller, seller_share=1000)
            support.post_user_message(seller, book, "سلام")
            support.post_support_message(self.admin, book, "جواب")
            _, (entry, _second) = Make.request(user, Make.user())
            support.post_user_message(user, entry, "سلام")
            Make.topup(user)
            Make.fund(seller, 5_000, self.admin)
            wallet_services.create_withdrawal(seller, 1_000, "6037991123456786")
            sold = Make.book(seller, Book.Status.APPROVED, price=0)
            Make.sale(user, sold, self.admin)
            Make.review(user, sold, "نظر")
            book.tags.create(name=f"برچسب {Make.next()}")

    def queries(self, url):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200, url)
        return len(ctx.captured_queries)

    def test_list_endpoints_have_a_fixed_number_of_queries(self):
        cache.clear()
        self.add_rows(2)
        small = {url: self.queries(url) for url in EXPECTED}
        self.add_rows(5)
        for url, expected in EXPECTED.items():
            with self.subTest(url=url):
                self.assertEqual(small[url], expected)
                self.assertEqual(self.queries(url), expected)

    def test_detail_pages_have_a_fixed_number_of_queries(self):
        cache.clear()
        user = Make.user()
        book_request, entries = Make.request(user, Make.user(), Make.user())
        for entry in entries:
            support.post_user_message(entry.requester, entry, "سلام")
        small = self.queries(f"/admin-api/book-requests/{book_request.pk}/")
        for _ in range(4):
            extra = Make.user()
            entry = book_request.entries.create(requester=extra)
            support.post_user_message(extra, entry, "سلام")
        self.assertEqual(self.queries(f"/admin-api/book-requests/{book_request.pk}/"), small)

        for _ in range(3):
            book = Make.book(Make.user(), Book.Status.APPROVED, price=0)
            Make.sale(user, book, self.admin)
            Make.book(user)
            Make.request(user)
        # The user (with balance), ledger, purchases, uploads, requests
        self.assertEqual(self.queries(f"/admin-api/users/{user.pk}/"), 5)
