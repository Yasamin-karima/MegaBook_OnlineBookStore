import threading

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import Book

from . import services
from .models import CartItem

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"


def make_user(email):
    return User.objects.create_user(email=email, first_name="a", last_name="b", password=PASSWORD)


class BookFactory:
    counter = 0

    @classmethod
    def make(cls, uploader, price=50_000, book_status=Book.Status.APPROVED, title=None):
        cls.counter += 1
        return Book.objects.create(
            title=title or f"کتاب {cls.counter}", isbn=f"978{cls.counter:010d}", status=book_status,
            price=price, uploaded_by=uploader, book_file="books/files/x.pdf",
        )


class CartApiTests(APITestCase):
    def setUp(self):
        self.user = make_user("buyer@example.com")
        self.seller = make_user("seller@example.com")
        self.book = BookFactory.make(self.seller, price=80_000)
        self.client.force_authenticate(self.user)

    def add(self, book_id, **extra):
        return self.client.post("/cart/items/", {"book_id": book_id, **extra}, format="json")

    def cart(self):
        return self.client.get("/cart/").data

    # --- adding ---

    def test_add_returns_the_whole_cart(self):
        res = self.add(self.book.pk)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["count"], 1)
        item = res.data["items"][0]
        self.assertEqual(item["book"]["id"], self.book.pk)
        self.assertEqual((item["price_seen"], item["status"]), (80_000, "ok"))
        self.assertEqual(res.data["total"], 80_000)
        self.assertEqual(res.data["balance"], 0)

    def test_adding_twice_is_idempotent(self):
        self.add(self.book.pk)
        res = self.add(self.book.pk)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)

    def test_price_seen_comes_from_the_database_not_the_client(self):
        self.add(self.book.pk, price_seen=1, price=1)
        self.assertEqual(CartItem.objects.get().price_seen, 80_000)

    def test_unapproved_and_missing_books_rejected(self):
        for book_status in (Book.Status.PENDING, Book.Status.REJECTED):
            book = BookFactory.make(self.seller, book_status=book_status)
            res = self.add(book.pk)
            self.assertEqual(res.status_code, 409)
            self.assertEqual(res.data["code"], services.NOT_AVAILABLE)
        res = self.add(999_999)
        self.assertEqual((res.status_code, res.data["code"]), (409, services.NOT_AVAILABLE))
        self.assertFalse(CartItem.objects.exists())

    def test_own_upload_rejected(self):
        own = BookFactory.make(self.user)
        res = self.add(own.pk)
        self.assertEqual((res.status_code, res.data["code"]), (409, services.OWN_UPLOAD))
        self.assertEqual(res.data["detail"], services.MESSAGES[services.OWN_UPLOAD])

    def test_owned_book_rejected(self):
        # Until the library exists, "owned" means uploaded; simulate a purchase by
        # patching the one ownership function that checkout will extend
        from unittest import mock
        with mock.patch("cart.services.owned_book_ids", return_value={self.book.pk}):
            res = self.add(self.book.pk)
        self.assertEqual((res.status_code, res.data["code"]), (409, services.ALREADY_OWNED))

    def test_cart_full(self):
        for _ in range(services.MAX_ITEMS):
            self.assertEqual(self.add(BookFactory.make(self.seller).pk).status_code, 201)
        res = self.add(BookFactory.make(self.seller).pk)
        self.assertEqual((res.status_code, res.data["code"]), (409, services.CART_FULL))
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), services.MAX_ITEMS)
        # A book already in a full cart is still "added" (idempotent), not an error
        self.assertEqual(self.add(CartItem.objects.first().book_id).status_code, 200)

    def test_invalid_book_id(self):
        res = self.client.post("/cart/items/", {}, format="json")
        self.assertEqual(res.data["book_id"], ["شناسهٔ کتاب را بفرستید."])

    # --- statuses and totals ---

    def test_price_change_and_acknowledge(self):
        self.add(self.book.pk)
        Book.objects.filter(pk=self.book.pk).update(price=95_000)  # the admin changes the price
        item = self.cart()["items"][0]
        self.assertEqual(item["status"], "price_changed")
        self.assertEqual((item["price_seen"], item["book"]["price"]), (80_000, 95_000))
        self.assertEqual(self.cart()["total"], 95_000)  # always the current price

        res = self.client.post("/cart/acknowledge-prices/", {"book_id": self.book.pk}, format="json")
        item = res.data["items"][0]
        self.assertEqual((item["status"], item["price_seen"]), ("ok", 95_000))

    def test_acknowledge_all(self):
        other = BookFactory.make(self.seller, price=10_000)
        self.add(self.book.pk)
        self.add(other.pk)
        Book.objects.filter(pk__in=[self.book.pk, other.pk]).update(price=1_000)
        res = self.client.post("/cart/acknowledge-prices/", {}, format="json")
        self.assertEqual({i["status"] for i in res.data["items"]}, {"ok"})

    def test_unapproved_book_becomes_unavailable_and_leaves_the_total(self):
        other = BookFactory.make(self.seller, price=30_000)
        self.add(self.book.pk)
        self.add(other.pk)
        Book.objects.filter(pk=self.book.pk).update(status=Book.Status.REJECTED)
        data = self.cart()
        statuses = {i["book"]["id"]: i["status"] for i in data["items"]}
        self.assertEqual(statuses, {self.book.pk: "unavailable", other.pk: "ok"})
        self.assertEqual((data["count"], data["total"]), (2, 30_000))

    def test_total_with_free_changed_and_unavailable(self):
        free = BookFactory.make(self.seller, price=0)
        changed = BookFactory.make(self.seller, price=20_000)
        gone = BookFactory.make(self.seller, price=70_000)
        for book in (self.book, free, changed, gone):
            self.add(book.pk)
        Book.objects.filter(pk=changed.pk).update(price=25_000)
        Book.objects.filter(pk=gone.pk).update(status=Book.Status.PENDING, price=None)
        data = self.cart()
        self.assertEqual(data["total"], 80_000 + 0 + 25_000)
        free_item = next(i for i in data["items"] if i["book"]["id"] == free.pk)
        self.assertTrue(free_item["book"]["is_free"])

    def test_owned_books_are_removed_and_reported(self):
        self.add(self.book.pk)
        from unittest import mock
        with mock.patch("cart.services.owned_book_ids", return_value={self.book.pk}):
            data = self.cart()
        self.assertEqual(data["removed"], [{"book_id": self.book.pk, "title": self.book.title}])
        self.assertEqual(data["count"], 0)
        self.assertFalse(CartItem.objects.exists())
        self.assertEqual(self.cart()["removed"], [])  # reported once

    def test_deleting_a_book_removes_its_cart_items(self):
        self.add(self.book.pk)
        self.book.delete()
        self.assertFalse(CartItem.objects.exists())

    # --- remove and clear ---

    def test_remove_and_clear(self):
        other = BookFactory.make(self.seller)
        self.add(self.book.pk)
        self.add(other.pk)
        res = self.client.delete(f"/cart/items/{self.book.pk}/")
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(self.client.delete(f"/cart/items/{self.book.pk}/").status_code, 200)  # not an error
        res = self.client.delete("/cart/")
        self.assertEqual(res.data["count"], 0)

    # --- privacy ---

    def test_other_users_cart_is_separate(self):
        self.add(self.book.pk)
        other = make_user("other@example.com")
        self.client.force_authenticate(other)
        self.assertEqual(self.cart()["count"], 0)
        # Removing "the same book" only touches the other user's own (empty) cart
        self.client.delete(f"/cart/items/{self.book.pk}/")
        self.client.delete("/cart/")
        self.assertEqual(CartItem.objects.filter(user=self.user).count(), 1)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        for method, url in [("get", "/cart/"), ("post", "/cart/items/"), ("delete", "/cart/items/1/"),
                            ("post", "/cart/acknowledge-prices/"), ("delete", "/cart/")]:
            with self.subTest(url=url, method=method):
                self.assertEqual(getattr(self.client, method)(url).status_code, 401)

    def test_never_exposes_book_file_or_seller_share(self):
        Book.objects.filter(pk=self.book.pk).update(seller_share=60_000)
        responses = [self.add(self.book.pk).data, self.cart()]
        for data in responses:
            text = str(data)
            self.assertNotIn("book_file", text)
            self.assertNotIn("seller_share", text)
            self.assertNotIn("books/files", text)
            self.assertEqual(set(data["items"][0]["book"]), {"id", "title", "authors", "cover", "price", "is_free"})


class IsOwnedTests(APITestCase):
    def setUp(self):
        self.user = make_user("u@example.com")
        self.own = BookFactory.make(self.user, title="کتاب خودم")
        self.other = BookFactory.make(make_user("s@example.com"), title="کتاب دیگری")

    def owned_flags(self):
        results = self.client.get("/catalog/books/").data["results"]
        return {b["id"]: b["is_owned"] for b in results}

    def test_guest_owns_nothing(self):
        self.assertEqual(set(self.owned_flags().values()), {False})
        self.assertFalse(self.client.get(f"/catalog/books/{self.own.pk}/").data["is_owned"])

    def test_uploader_owns_their_book(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.owned_flags(), {self.own.pk: True, self.other.pk: False})
        self.assertTrue(self.client.get(f"/catalog/books/{self.own.pk}/").data["is_owned"])
        self.assertFalse(self.client.get(f"/catalog/books/{self.other.pk}/").data["is_owned"])


class ConcurrentAddTests(TransactionTestCase):
    """Two adds at once when one slot is left: the lock on the user's row makes the
    second wait and see the full cart."""

    def test_cap_holds_under_concurrency(self):
        user = make_user("c@example.com")
        seller = make_user("cs@example.com")
        for _ in range(services.MAX_ITEMS - 1):
            CartItem.objects.create(user=user, book=(b := BookFactory.make(seller)), price_seen=b.price)
        books = [BookFactory.make(seller), BookFactory.make(seller)]
        barrier = threading.Barrier(2)
        results = []

        def worker(book):
            try:
                barrier.wait()
                results.append(services.add(user, book.pk))
            except services.CartError as error:
                results.append(error.code)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(b,)) for b in books]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        self.assertCountEqual(results, [True, services.CART_FULL])
        self.assertEqual(CartItem.objects.filter(user=user).count(), services.MAX_ITEMS)
