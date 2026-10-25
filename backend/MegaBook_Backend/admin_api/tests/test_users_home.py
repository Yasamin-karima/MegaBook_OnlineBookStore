from datetime import datetime, timezone as dt_timezone
from unittest import mock

from catalog.models import Book
from wallet import services as wallet_services

from admin_api import jalali

from .helpers import AdminApiTestCase, Make


class UserTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = Make.user("yasamin", phone="09121234567")
        Make.fund(self.user, 65_000, self.admin)

    def test_list_with_computed_balance_and_search(self):
        data = self.client.get("/admin-api/users/", {"search": "yasamin"}).data
        self.assertEqual((data["count"], data["results"][0]["balance"]), (1, 65_000))
        # Phone in another form, normalized like the login
        self.assertEqual(self.client.get("/admin-api/users/", {"search": "+98 912 123 4567"}).data["count"], 1)
        self.assertEqual(self.client.get("/admin-api/users/", {"search": "۰۹۱۲۱۲۳"}).data["count"], 1)

    def test_detail_lists_everything_and_changes_nothing(self):
        uploader = Make.user("seller")
        book = Make.book(uploader, Book.Status.APPROVED, price=20_000, seller_share=15_000)
        Make.sale(self.user, book, self.admin)
        Make.book(self.user)
        Make.request(self.user)
        data = self.client.get(f"/admin-api/users/{self.user.pk}/").data
        self.assertEqual(data["balance"], 65_000)
        self.assertEqual([p["id"] for p in data["purchases"]], [book.pk])
        self.assertEqual(len(data["uploads"]), 1)
        self.assertEqual(len(data["requests"]), 1)
        self.assertEqual({e["type"] for e in data["ledger"]}, {"adjustment", "purchase"})
        # Read-only
        self.assertEqual(self.client.patch(f"/admin-api/users/{self.user.pk}/", {"first_name": "x"}).status_code, 405)


class JalaliTests(AdminApiTestCase):
    def test_known_dates_and_round_trip(self):
        self.assertEqual(jalali.gregorian_to_jalali(2026, 3, 21), (1405, 1, 1))
        self.assertEqual(jalali.gregorian_to_jalali(2024, 3, 20), (1403, 1, 1))
        self.assertEqual(jalali.gregorian_to_jalali(2026, 10, 25), (1405, 8, 3))
        self.assertEqual(jalali.gregorian_to_jalali(2025, 3, 20), (1403, 12, 30))  # 1403 is a leap year
        for g in ((2000, 1, 1), (2024, 2, 29), (2026, 9, 22), (2030, 12, 31)):
            self.assertEqual(jalali.jalali_to_gregorian(*jalali.gregorian_to_jalali(*g)), g)

    def test_day_and_month_start_in_tehran(self):
        # 22:00 UTC on 24 Oct 2026 is already 25 Oct (3 Aban) in Tehran (UTC+3:30)
        period = jalali.periods(datetime(2026, 10, 24, 22, 0, tzinfo=dt_timezone.utc))
        self.assertEqual(period["today_label"], "۳ آبان ۱۴۰۵")
        self.assertEqual(period["today_start"].astimezone(dt_timezone.utc), datetime(2026, 10, 24, 20, 30, tzinfo=dt_timezone.utc))
        # 1 Aban 1405 = 23 Oct 2026
        self.assertEqual(period["month_start"].date().isoformat(), "2026-10-23")


class HomeTests(AdminApiTestCase):
    def test_counts_and_summary(self):
        user, seller = Make.user("buyer"), Make.user("seller")
        Make.book(seller, seller_share=1)
        Make.request(user)
        Make.topup(user)
        book = Make.book(seller, Book.Status.APPROVED, price=40_000, seller_share=30_000)
        Make.sale(user, book, self.admin)
        Make.fund(seller, 10_000, self.admin)
        wallet_services.create_withdrawal(seller, 25_000, "6037991123456786")

        counts = self.client.get("/admin-api/counts/").data
        self.assertEqual(counts, {"books": 1, "requests": 1, "conversations": 0, "wallet": 2, "reviews": 0})

        data = self.client.get("/admin-api/summary/").data
        self.assertEqual(data["queues"]["books"]["count"], 1)
        self.assertIsNotNone(data["queues"]["topups"]["oldest_at"])
        finance = data["finance"]
        self.assertEqual((finance["sales_today"], finance["gross_today"], finance["commission_today"]), (1, 40_000, 10_000))
        self.assertEqual((finance["sales_month"], finance["gross_month"]), (1, 40_000))
        self.assertEqual(finance["pending_withdrawals_total"], 25_000)

    def test_sales_before_today_in_tehran_are_not_today(self):
        seller, buyer = Make.user("s"), Make.user("b")
        book = Make.book(seller, Book.Status.APPROVED, price=1_000)
        Make.sale(buyer, book, self.admin)
        # Pretend it's now the next Jalali month: the sale is neither today nor this month
        later = datetime(2099, 1, 1, 12, 0, tzinfo=dt_timezone.utc)
        with mock.patch("admin_api.home.timezone.now", return_value=later):
            finance = self.client.get("/admin-api/summary/").data["finance"]
        self.assertEqual((finance["sales_today"], finance["sales_month"]), (0, 0))
