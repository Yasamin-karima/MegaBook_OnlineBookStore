import threading

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from cart import services as cart_services
from cart.models import CartItem
from catalog.models import Book
from library.models import LibraryItem
from wallet import services as wallet_services
from wallet.models import LedgerEntry

from . import services
from .admin import OrderAdmin
from .models import ImmutableOrderError, Order, OrderItem

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"


def make_user(email, **extra):
    return User.objects.create_user(email=email, first_name="a", last_name="b", password=PASSWORD, **extra)


def make_admin(email="admin@example.com"):
    return User.objects.create_superuser(email=email, first_name="a", last_name="b", password=PASSWORD)


class BookFactory:
    counter = 0

    @classmethod
    def make(cls, uploader, price=50_000, share=0, book_status=Book.Status.APPROVED, title=None):
        cls.counter += 1
        return Book.objects.create(
            title=title or f"کتاب {cls.counter}", isbn=f"979{cls.counter:010d}", status=book_status,
            price=price, seller_share=share, uploaded_by=uploader, book_file="books/files/x.pdf",
        )


def fund(user, amount, admin):
    wallet_services.adjust(wallet_services.wallet_of(user), amount, "شارژ آزمایشی", admin)


def balance(user):
    return wallet_services.balance_of(wallet_services.wallet_of(user))


def platform_balance():
    return wallet_services.balance_of(wallet_services.platform_wallet())


class CheckoutTestBase(APITestCase):
    def setUp(self):
        self.admin = make_admin()
        self.buyer = make_user("buyer@example.com")
        self.seller1 = make_user("seller1@example.com")
        self.seller2 = make_user("seller2@example.com")
        self.client.force_authenticate(self.buyer)

    def add(self, *books):
        for book in books:
            cart_services.add(self.buyer, book.pk)

    def checkout(self):
        return self.client.post(reverse("checkout"))

    def assert_nothing_saved(self, cart_size):
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(OrderItem.objects.count(), 0)
        self.assertEqual(LibraryItem.objects.count(), 0)
        self.assertFalse(LedgerEntry.objects.filter(type__in=LedgerEntry.TRANSFER_TYPES).exists())
        self.assertEqual(CartItem.objects.filter(user=self.buyer).count(), cart_size)


class CheckoutTests(CheckoutTestBase):
    def test_two_books_from_two_uploaders(self):
        fund(self.buyer, 200_000, self.admin)
        a = BookFactory.make(self.seller1, price=80_000, share=60_000, title="الف")
        b = BookFactory.make(self.seller2, price=50_000, share=40_000, title="ب")
        self.add(a, b)

        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["total"], 130_000)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(
            [(i["book_id"], i["title"], i["price"]) for i in response.data["items"]],
            [(a.pk, "الف", 80_000), (b.pk, "ب", 50_000)],
        )

        order = Order.objects.get()
        self.assertEqual((order.buyer, order.items.count()), (self.buyer, 2))
        self.assertEqual(set(LibraryItem.objects.filter(user=self.buyer).values_list("book", flat=True)), {a.pk, b.pk})

        entries = list(LedgerEntry.objects.filter(type__in=LedgerEntry.TRANSFER_TYPES))
        self.assertEqual(sum(e.amount for e in entries), 0)
        self.assertEqual(len({e.group for e in entries}), 1)
        debit = LedgerEntry.objects.get(type="purchase")
        self.assertEqual((debit.amount, debit.order, debit.order_item), (-130_000, order, None))
        self.assertIn("۲ کتاب", debit.description)
        self.assertIn("«الف»", debit.description)
        item_a = order.items.get(book=a)
        self.assertEqual(
            {(e.type, e.amount) for e in LedgerEntry.objects.filter(order_item=item_a)},
            {("sale_income", 60_000), ("commission", 20_000)},
        )
        self.assertIn("«الف»", LedgerEntry.objects.get(order_item=item_a, type="sale_income").description)

        self.assertEqual(balance(self.buyer), 70_000)
        self.assertEqual(balance(self.seller1), 60_000)
        self.assertEqual(balance(self.seller2), 40_000)
        self.assertEqual(platform_balance(), 30_000)
        self.assertFalse(CartItem.objects.filter(user=self.buyer).exists())

    def test_free_only_cart_creates_order_without_ledger_entries(self):
        a = BookFactory.make(self.seller1, price=0)
        b = BookFactory.make(self.seller2, price=0)
        self.add(a, b)
        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["total"], 0)
        self.assertEqual(OrderItem.objects.count(), 2)
        self.assertEqual(LibraryItem.objects.count(), 2)
        self.assertFalse(LedgerEntry.objects.filter(type__in=LedgerEntry.TRANSFER_TYPES).exists())
        self.assertFalse(CartItem.objects.exists())

    def test_free_book_next_to_paid_one_has_no_entries(self):
        fund(self.buyer, 50_000, self.admin)
        free = BookFactory.make(self.seller1, price=0)
        paid = BookFactory.make(self.seller2, price=30_000, share=20_000)
        self.add(free, paid)
        self.assertEqual(self.checkout().status_code, status.HTTP_201_CREATED)
        self.assertFalse(LedgerEntry.objects.filter(order_item__book=free).exists())
        self.assertEqual(LedgerEntry.objects.filter(type__in=LedgerEntry.TRANSFER_TYPES).count(), 3)

    def test_admin_book_pays_everything_to_the_platform(self):
        fund(self.buyer, 50_000, self.admin)
        book = BookFactory.make(self.admin, price=30_000, share=0)
        self.add(book)
        self.assertEqual(self.checkout().status_code, status.HTTP_201_CREATED)
        self.assertFalse(LedgerEntry.objects.filter(type="sale_income").exists())
        self.assertEqual(LedgerEntry.objects.get(type="commission").amount, 30_000)
        self.assertEqual(platform_balance(), 30_000)

    def test_price_equal_to_share_has_no_commission_entry(self):
        fund(self.buyer, 50_000, self.admin)
        self.add(BookFactory.make(self.seller1, price=30_000, share=30_000))
        self.assertEqual(self.checkout().status_code, status.HTTP_201_CREATED)
        self.assertFalse(LedgerEntry.objects.filter(type="commission").exists())

    def test_insufficient_balance_saves_nothing(self):
        fund(self.buyer, 50_000, self.admin)
        self.add(BookFactory.make(self.seller1, price=40_000, share=30_000),
                 BookFactory.make(self.seller2, price=30_000, share=20_000))
        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "insufficient_balance")
        self.assertEqual(response.data["shortfall"], 20_000)
        self.assertIn("۲۰٬۰۰۰ تومان", response.data["detail"])
        self.assert_nothing_saved(cart_size=2)
        self.assertEqual(balance(self.buyer), 50_000)

    def test_price_change_blocks_until_acknowledged(self):
        fund(self.buyer, 100_000, self.admin)
        book = BookFactory.make(self.seller1, price=40_000, share=30_000)
        self.add(book)
        book.price = 60_000
        book.save()

        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "cart_changed")
        self.assertEqual(response.data["cart"]["items"][0]["status"], "price_changed")
        self.assert_nothing_saved(cart_size=1)
        self.assertEqual(balance(self.buyer), 100_000)

        cart_services.acknowledge_prices(self.buyer, book.pk)
        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["total"], 60_000)
        self.assertEqual(balance(self.buyer), 40_000)

    def test_unavailable_book_blocks_checkout(self):
        fund(self.buyer, 100_000, self.admin)
        ok = BookFactory.make(self.seller1, price=10_000)
        gone = BookFactory.make(self.seller2, price=10_000)
        self.add(ok, gone)
        gone.status = Book.Status.REJECTED
        gone.save()
        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "cart_changed")
        self.assertEqual({i["status"] for i in response.data["cart"]["items"]}, {"ok", "unavailable"})
        self.assert_nothing_saved(cart_size=2)

    def test_empty_cart_rejected(self):
        response = self.checkout()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "empty_cart")
        self.assertEqual(Order.objects.count(), 0)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.checkout().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_order_item_keeps_the_price_paid(self):
        fund(self.buyer, 100_000, self.admin)
        book = BookFactory.make(self.seller1, price=40_000, share=30_000)
        self.add(book)
        self.checkout()
        book.price, book.seller_share = 90_000, 10_000
        book.save()
        item = OrderItem.objects.get()
        self.assertEqual((item.price, item.seller_share, item.commission), (40_000, 30_000, 10_000))
        orders = self.client.get(reverse("order_list")).data["results"]
        self.assertEqual((orders[0]["total"], orders[0]["items"][0]["price"]), (40_000, 40_000))

    def test_sold_book_cannot_be_deleted(self):
        book = BookFactory.make(self.seller1, price=0)
        self.add(book)
        self.checkout()
        from django.db.models import ProtectedError
        with self.assertRaises(ProtectedError):
            book.delete()

    def test_responses_never_expose_book_file_or_seller_share(self):
        fund(self.buyer, 100_000, self.admin)
        self.add(BookFactory.make(self.seller1, price=40_000, share=30_000))
        bodies = [
            self.checkout().content,
            self.client.get(reverse("order_list")).content,
            self.client.get(reverse("library")).content,
        ]
        self.client.force_authenticate(self.seller1)
        bodies.append(self.client.get(reverse("my_uploads")).content)
        for body in bodies:
            self.assertNotIn(b"book_file", body)
            self.assertNotIn(b"seller_share", body)
            self.assertNotIn(b"books/files", body)


class AfterPurchaseTests(CheckoutTestBase):
    def setUp(self):
        super().setUp()
        self.book = BookFactory.make(self.seller1, price=0)

    def file_link(self):
        return self.client.get(reverse("book_file_link", args=[self.book.pk]))

    def test_ownership_everywhere(self):
        # Before: not owned, no download
        self.assertEqual(self.file_link().status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(self.client.get(reverse("book_detail", args=[self.book.pk])).data["is_owned"])

        self.add(self.book)
        self.checkout()

        self.assertTrue(self.client.get(reverse("book_detail", args=[self.book.pk])).data["is_owned"])
        self.assertTrue(self.book.can_download_file(self.buyer))
        link = self.file_link()
        self.assertEqual(link.status_code, status.HTTP_200_OK)
        self.assertEqual(link.data["title"], self.book.title)
        response = self.client.post(reverse("cart_items"), {"book_id": self.book.pk})
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "already_owned")

    def test_still_readable_after_leaving_the_store(self):
        self.add(self.book)
        self.checkout()
        self.book.status = Book.Status.REJECTED
        self.book.save()
        self.assertTrue(self.book.can_download_file(self.buyer))
        self.assertEqual(self.client.get(reverse("library")).data["count"], 1)

    def test_is_owned_does_not_duplicate_books_in_the_list(self):
        other = make_user("other@example.com")
        for user in (self.buyer, other):
            cart_services.add(user, self.book.pk)
            services.checkout(user)
        ids = [b["id"] for b in self.client.get(reverse("book_list_create")).data["results"]]
        self.assertEqual(ids.count(self.book.pk), 1)

    def test_library_reports_what_the_page_needs(self):
        self.add(self.book)
        self.checkout()
        data = self.client.get(reverse("library")).data
        self.assertEqual(data["count"], 1)
        self.assertEqual(set(data["results"][0]), {"id", "title", "authors", "cover", "purchased_at"})
        self.assertEqual(data["results"][0]["id"], self.book.pk)
        summary = self.client.get(reverse("library_summary")).data
        self.assertEqual(summary, {"purchased": 1, "uploaded": 0, "bookmarked": None})

    def test_library_uploads_are_only_approved_books(self):
        # The library is for reading (DECISIONS 11.4): pending and rejected uploads are
        # tracked on "My Requests & Uploads", not listed here
        BookFactory.make(self.seller1, price=None, book_status=Book.Status.PENDING)
        BookFactory.make(self.seller1, price=None, book_status=Book.Status.REJECTED)
        self.client.force_authenticate(self.seller1)
        data = self.client.get(reverse("my_uploads")).data
        self.assertEqual({b["status"] for b in data["results"]}, {"approved"})
        self.assertEqual(self.client.get(reverse("library_summary")).data["uploaded"], 1)
        # Uploads are never in the uploader's purchased library
        self.assertEqual(self.client.get(reverse("library")).data["count"], 0)


class IsolationTests(CheckoutTestBase):
    def test_users_only_see_their_own_orders_and_library(self):
        book = BookFactory.make(self.seller1, price=0)
        self.add(book)
        self.checkout()
        other = make_user("other@example.com")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(reverse("order_list")).data["count"], 0)
        self.assertEqual(self.client.get(reverse("library")).data["count"], 0)
        self.assertEqual(self.client.get(reverse("library_summary")).data["purchased"], 0)
        self.assertEqual(self.client.get(reverse("book_file_link", args=[book.pk])).status_code, 404)

    def test_lists_require_login(self):
        self.client.force_authenticate(None)
        for name in ("order_list", "library", "library_summary", "my_uploads"):
            self.assertEqual(self.client.get(reverse(name)).status_code, status.HTTP_401_UNAUTHORIZED, name)


class ImmutabilityTests(TestCase):
    def setUp(self):
        buyer = make_user("buyer@example.com")
        book = BookFactory.make(make_user("seller@example.com"), price=0)
        cart_services.add(buyer, book.pk)
        self.order = services.checkout(buyer)
        self.item = self.order.items.get()

    def test_orders_and_items_cannot_change(self):
        for obj in (self.order, self.item):
            with self.assertRaises(ImmutableOrderError):
                obj.save()
            with self.assertRaises(ImmutableOrderError):
                obj.delete()
        with self.assertRaises(ImmutableOrderError):
            OrderItem.objects.update(price=1)
        with self.assertRaises(ImmutableOrderError):
            Order.objects.all().delete()

    def test_admin_is_read_only(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        request = RequestFactory().get("/")
        request.user = make_admin()
        model_admin = OrderAdmin(Order, site)
        self.assertFalse(model_admin.has_add_permission(request))
        self.assertFalse(model_admin.has_change_permission(request, self.order))
        self.assertFalse(model_admin.has_delete_permission(request, self.order))
        self.assertTrue(model_admin.has_view_permission(request, self.order))


class ConcurrentCheckoutTests(TransactionTestCase):
    """Real threads with their own database connections, like parallel requests."""

    def setUp(self):
        self.admin = make_admin()
        self.buyer = make_user("buyer@example.com")
        self.seller = make_user("seller@example.com")

    def run_together(self, *calls):
        barrier = threading.Barrier(len(calls))
        results = [None] * len(calls)

        def worker(i, call):
            try:
                barrier.wait()
                results[i] = call()
            except Exception as error:  # noqa: BLE001 (the test inspects it)
                results[i] = error
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(i, c)) for i, c in enumerate(calls)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        return results

    def test_double_checkout_buys_and_pays_once(self):
        fund(self.buyer, 100_000, self.admin)
        book = BookFactory.make(self.seller, price=40_000, share=30_000)
        cart_services.add(self.buyer, book.pk)

        results = self.run_together(lambda: services.checkout(self.buyer), lambda: services.checkout(self.buyer))
        orders = [r for r in results if isinstance(r, Order)]
        errors = [r for r in results if isinstance(r, services.CheckoutError)]
        self.assertEqual((len(orders), len(errors)), (1, 1), results)
        self.assertEqual(errors[0].code, services.EMPTY_CART)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(LibraryItem.objects.count(), 1)
        self.assertEqual(balance(self.buyer), 60_000)
        self.assertEqual(balance(self.seller), 30_000)

    def test_two_users_buying_each_others_books_do_not_deadlock(self):
        fund(self.buyer, 100_000, self.admin)
        fund(self.seller, 100_000, self.admin)
        cart_services.add(self.buyer, BookFactory.make(self.seller, price=40_000, share=30_000).pk)
        cart_services.add(self.seller, BookFactory.make(self.buyer, price=20_000, share=10_000).pk)

        results = self.run_together(lambda: services.checkout(self.buyer), lambda: services.checkout(self.seller))
        self.assertTrue(all(isinstance(r, Order) for r in results), results)
        self.assertEqual(balance(self.buyer), 100_000 - 40_000 + 10_000)
        self.assertEqual(balance(self.seller), 100_000 - 20_000 + 30_000)
