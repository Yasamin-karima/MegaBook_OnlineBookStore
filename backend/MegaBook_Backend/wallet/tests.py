import io
import re
import shutil
import tempfile
import threading
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.models import Book

from . import services
from .models import GatewayPayment, ImmutableLedgerError, LedgerEntry, TopUpRequest, Wallet, WithdrawalRequest
from .normalize import CARD_CHECKSUM, CARD_LENGTH, luhn_is_valid, normalize_card_number, normalize_tracking_number

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"
TEMP_MEDIA = tempfile.mkdtemp()


def make_user(email, **extra):
    return User.objects.create_user(email=email, first_name="Sara", last_name="Ahmadi", password=PASSWORD, **extra)


def make_admin(email="admin@example.com"):
    return User.objects.create_superuser(email=email, first_name="Admin", last_name="Test", password=PASSWORD)


def card_with_check_digit(first15):
    """A 16-digit card number with a valid Luhn check digit."""
    for d in "0123456789":
        if luhn_is_valid(first15 + d):
            return first15 + d


VALID_CARD = card_with_check_digit("603799123456789")


def topup_request(user, amount=100_000, tracking="123456", **extra):
    extra.setdefault("deposited_at", timezone.now() - timedelta(hours=1))
    return TopUpRequest.objects.create(user=user, amount=amount, tracking_number=tracking, **extra)


def fund(user, amount, admin):
    """Give a user money the way real money arrives: an approved top-up."""
    request = topup_request(user, amount=amount, tracking=f"T{TopUpRequest.objects.count() + 1}")
    services.approve_topup(request, admin)


def balance(user):
    return services.balance_of(services.wallet_of(user))


def png_file():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), "white").save(buffer, format="PNG")
    return SimpleUploadedFile("receipt.png", buffer.getvalue(), content_type="image/png")


# ---------------------------------------------------------------------------
# Wallet creation
# ---------------------------------------------------------------------------

class WalletCreationTests(APITestCase):
    def assert_one_wallet(self, user):
        self.assertEqual(Wallet.objects.filter(owner=user, kind=Wallet.Kind.USER).count(), 1)

    def test_create_user(self):
        self.assert_one_wallet(make_user("a@example.com"))

    def test_create_superuser(self):
        self.assert_one_wallet(make_admin())

    def test_registration_api(self):
        self.client.post("/accounts/register/", {
            "first_name": "سارا", "last_name": "احمدی", "phone": "09121234567", "password": PASSWORD,
        }, format="json")
        self.assert_one_wallet(User.objects.get(phone="09121234567"))

    def test_get_or_create_like_seed_books(self):
        # seed_books creates its sample uploader with get_or_create, not the manager
        user, _ = User.objects.get_or_create(
            email="sample@megabook.invalid", defaults={"first_name": "a", "last_name": "b"}
        )
        self.assert_one_wallet(user)

    def test_admin_add_form(self):
        self.client.force_login(make_admin())
        self.client.post("/admin/accounts/account/add/", {
            "email": "new@example.com", "phone": "", "first_name": "a", "last_name": "b",
            "usable_password": "true", "password1": PASSWORD, "password2": PASSWORD,
        })
        self.assert_one_wallet(User.objects.get(email="new@example.com"))

    def test_saving_a_user_again_does_not_add_a_wallet(self):
        user = make_user("a@example.com")
        user.first_name = "Ali"
        user.save()
        self.assert_one_wallet(user)

    def test_platform_wallet_exists_after_migrations(self):
        # The test database is built by running the migrations, including the data migration
        self.assertEqual(Wallet.objects.filter(kind=Wallet.Kind.PLATFORM).count(), 1)
        self.assertIsNone(services.platform_wallet().owner)

    def test_only_one_platform_wallet(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Wallet.objects.create(kind=Wallet.Kind.PLATFORM)

    def test_one_wallet_per_user(self):
        user = make_user("a@example.com")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Wallet.objects.create(kind=Wallet.Kind.USER, owner=user)

    def test_user_wallet_needs_owner_and_platform_has_none(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Wallet.objects.create(kind=Wallet.Kind.USER)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Wallet.objects.create(kind=Wallet.Kind.PLATFORM, owner=make_user("x@example.com"))


# ---------------------------------------------------------------------------
# Balance and immutability
# ---------------------------------------------------------------------------

class BalanceAndImmutabilityTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("a@example.com")
        self.wallet = services.wallet_of(self.user)

    def test_new_wallet_balance_is_zero(self):
        self.assertEqual(services.balance_of(self.wallet), 0)

    def test_balance_is_the_sum_of_entries(self):
        fund(self.user, 100_000, self.admin)
        services.adjust(self.wallet, -30_000, "اصلاح آزمایشی", self.admin)
        services.adjust(self.wallet, 5_000, "اصلاح آزمایشی", self.admin)
        total = sum(LedgerEntry.objects.filter(wallet=self.wallet).values_list("amount", flat=True))
        self.assertEqual(services.balance_of(self.wallet), 75_000)
        self.assertEqual(total, 75_000)

    def test_entries_cannot_be_updated_or_deleted(self):
        fund(self.user, 100_000, self.admin)
        entry = LedgerEntry.objects.get(wallet=self.wallet)
        entry.amount = 1
        with self.assertRaises(ImmutableLedgerError):
            entry.save()
        with self.assertRaises(ImmutableLedgerError):
            entry.delete()
        with self.assertRaises(ImmutableLedgerError):
            LedgerEntry.objects.filter(pk=entry.pk).update(amount=1)
        with self.assertRaises(ImmutableLedgerError):
            LedgerEntry.objects.filter(pk=entry.pk).delete()
        self.assertEqual(LedgerEntry.objects.get(pk=entry.pk).amount, 100_000)

    def test_zero_amount_rejected_by_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            LedgerEntry.objects.create(
                wallet=self.wallet, amount=0, type=LedgerEntry.Type.ADJUSTMENT, description="x", created_by=self.admin
            )

    def test_sign_must_match_type(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            LedgerEntry.objects.create(
                wallet=self.wallet, amount=-5, type=LedgerEntry.Type.TOPUP, topup_request=topup_request(self.user)
            )

    def test_only_services_create_ledger_entries(self):
        # "No other code creates LedgerEntry rows": scan the project's source
        # (?<!class ): the model's own definition "class LedgerEntry(" doesn't count
        pattern = re.compile(r"LedgerEntry\.objects\.(create|bulk_create|get_or_create)|(?<!class )LedgerEntry\(|entries\.create")
        base = Path(settings.BASE_DIR)
        offenders = []
        for path in base.rglob("*.py"):
            relative = path.relative_to(base).as_posix()
            if relative.split("/")[0] in ("venv", ".venv", "media") or "/migrations/" in relative:
                continue
            if relative in ("wallet/services.py", "wallet/tests.py"):
                continue
            if pattern.search(path.read_text(encoding="utf-8")):
                offenders.append(relative)
        self.assertEqual(offenders, [])


# ---------------------------------------------------------------------------
# Top-ups
# ---------------------------------------------------------------------------

class TopUpTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("a@example.com")

    def test_approve_credits_once(self):
        request = topup_request(self.user, amount=50_000)
        services.approve_topup(request, self.admin)
        self.assertEqual(balance(self.user), 50_000)
        request.refresh_from_db()
        self.assertEqual((request.status, request.reviewed_by), (TopUpRequest.Status.APPROVED, self.admin))

        with self.assertRaises(services.WalletError) as ctx:
            services.approve_topup(request, self.admin)
        self.assertEqual(ctx.exception.message, services.ALREADY_REVIEWED)
        self.assertEqual(balance(self.user), 50_000)

    def test_database_stops_a_second_entry_for_the_same_request(self):
        request = topup_request(self.user, amount=50_000)
        services.approve_topup(request, self.admin)
        with self.assertRaises(IntegrityError), transaction.atomic():
            LedgerEntry.objects.create(
                wallet=services.wallet_of(self.user), amount=50_000, type=LedgerEntry.Type.TOPUP, topup_request=request
            )

    def test_tracking_number_is_normalized(self):
        request = topup_request(self.user, tracking="۱۲۳ ۴۵۶-ab")
        self.assertEqual(request.tracking_number, "123456AB")
        self.assertEqual(normalize_tracking_number("١٢٣٤"), "1234")

    def test_duplicate_tracking_number_rejected_including_persian_digits(self):
        topup_request(self.user, tracking="123456")
        with self.assertRaises(IntegrityError), transaction.atomic():
            topup_request(make_user("b@example.com"), tracking="۱۲۳ ۴۵۶")

    def test_tracking_number_reusable_after_rejection(self):
        first = topup_request(self.user, tracking="123456")
        services.reject_topup(first, self.admin, "مبلغ با رسید نمی‌خواند")
        second = topup_request(self.user, tracking="123456", amount=70_000)
        services.approve_topup(second, self.admin)
        self.assertEqual(balance(self.user), 70_000)

    def test_reject_needs_reason_and_is_final(self):
        request = topup_request(self.user)
        with self.assertRaises(services.WalletError):
            services.reject_topup(request, self.admin, "  ")
        services.reject_topup(request, self.admin, "رسید نامعتبر")
        with self.assertRaises(services.WalletError):
            services.approve_topup(request, self.admin)
        self.assertEqual(balance(self.user), 0)

    def test_final_status_cannot_be_changed_by_saving(self):
        request = topup_request(self.user)
        services.approve_topup(request, self.admin)
        request.refresh_from_db()
        request.status = TopUpRequest.Status.PENDING
        request.reviewed_at = None
        with self.assertRaises(ValidationError):
            request.save()

    def test_only_staff_can_approve(self):
        with self.assertRaises(services.WalletError):
            services.approve_topup(topup_request(self.user), self.user)

    def test_deposit_in_future_rejected(self):
        with self.assertRaises(ValidationError):
            topup_request(self.user, deposited_at=timezone.now() + timedelta(days=1))


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------

class WithdrawalTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("a@example.com")
        fund(self.user, 100_000, self.admin)

    def test_debits_immediately(self):
        request = services.create_withdrawal(self.user, 30_000, VALID_CARD)
        self.assertEqual(request.status, WithdrawalRequest.Status.PENDING)
        self.assertEqual(balance(self.user), 70_000)

    def test_cannot_exceed_balance(self):
        with self.assertRaises(services.WalletError) as ctx:
            services.create_withdrawal(self.user, 100_001, VALID_CARD)
        self.assertEqual(ctx.exception.message, services.INSUFFICIENT_BALANCE)
        self.assertFalse(WithdrawalRequest.objects.exists())
        self.assertEqual(balance(self.user), 100_000)

    def test_whole_balance_can_be_withdrawn(self):
        services.create_withdrawal(self.user, 100_000, VALID_CARD)
        self.assertEqual(balance(self.user), 0)

    def test_second_pending_withdrawal_rejected(self):
        services.create_withdrawal(self.user, 10_000, VALID_CARD)
        with self.assertRaises(services.WalletError) as ctx:
            services.create_withdrawal(self.user, 10_000, VALID_CARD)
        self.assertEqual(ctx.exception.message, services.PENDING_WITHDRAWAL_EXISTS)
        self.assertEqual(balance(self.user), 90_000)

    def test_database_allows_one_pending_per_user(self):
        services.create_withdrawal(self.user, 10_000, VALID_CARD)
        with self.assertRaises(IntegrityError), transaction.atomic():
            WithdrawalRequest.objects.create(user=self.user, amount=1, card_number=VALID_CARD)

    def test_rejection_restores_balance_and_allows_a_new_request(self):
        request = services.create_withdrawal(self.user, 40_000, VALID_CARD)
        services.reject_withdrawal(request, self.admin, "شماره کارت به نام شما نیست")
        self.assertEqual(balance(self.user), 100_000)
        self.assertTrue(
            LedgerEntry.objects.filter(withdrawal_request=request, type=LedgerEntry.Type.WITHDRAWAL_REVERSAL).exists()
        )
        services.create_withdrawal(self.user, 10_000, VALID_CARD)

    def test_completion_does_not_change_balance_and_is_final(self):
        request = services.create_withdrawal(self.user, 40_000, VALID_CARD)
        services.complete_withdrawal(request, self.admin)
        self.assertEqual(balance(self.user), 60_000)
        with self.assertRaises(services.WalletError):
            services.reject_withdrawal(request, self.admin, "دیر شد")
        self.assertEqual(balance(self.user), 60_000)

    def test_invalid_card_numbers_rejected(self):
        bad_check = VALID_CARD[:-1] + str((int(VALID_CARD[-1]) + 1) % 10)
        for card, message in [("1234", CARD_LENGTH), (VALID_CARD + "1", CARD_LENGTH), (bad_check, CARD_CHECKSUM)]:
            with self.subTest(card=card):
                with self.assertRaises(services.WalletError) as ctx:
                    services.create_withdrawal(self.user, 1_000, card)
                self.assertEqual((ctx.exception.message, ctx.exception.field), (message, "card_number"))
        self.assertEqual(balance(self.user), 100_000)

    def test_card_with_spaces_or_persian_digits_is_normalized(self):
        persian = VALID_CARD.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
        spaced = " ".join(persian[i:i + 4] for i in range(0, 16, 4))
        self.assertEqual(normalize_card_number(spaced), VALID_CARD)
        request = services.create_withdrawal(self.user, 1_000, spaced)
        self.assertEqual(request.card_number, VALID_CARD)

    def test_amount_must_be_positive(self):
        for amount in (0, -5):
            with self.assertRaises(services.WalletError):
                services.create_withdrawal(self.user, amount, VALID_CARD)


# ---------------------------------------------------------------------------
# Manual adjustment and transfers
# ---------------------------------------------------------------------------

class AdjustmentTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("a@example.com")
        self.wallet = services.wallet_of(self.user)

    def test_records_admin_and_description(self):
        entry = services.adjust(self.wallet, 2_000, "جبران خطای شارژ", self.admin)
        self.assertEqual((entry.created_by, entry.description, entry.type), (self.admin, "جبران خطای شارژ", "adjustment"))

    def test_description_required_and_zero_rejected(self):
        with self.assertRaises(services.WalletError):
            services.adjust(self.wallet, 2_000, " ", self.admin)
        with self.assertRaises(services.WalletError):
            services.adjust(self.wallet, 0, "x", self.admin)

    def test_cannot_take_user_below_zero(self):
        services.adjust(self.wallet, 1_000, "x", self.admin)
        with self.assertRaises(services.WalletError):
            services.adjust(self.wallet, -1_001, "x", self.admin)
        self.assertEqual(services.balance_of(self.wallet), 1_000)

    def test_only_staff(self):
        with self.assertRaises(services.WalletError):
            services.adjust(self.wallet, 1_000, "x", self.user)


class TransferTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.buyer = make_user("buyer@example.com")
        self.seller = make_user("seller@example.com")
        fund(self.buyer, 100_000, self.admin)

    def book(self, price, share, uploader=None):
        return Book.objects.create(
            title="x", isbn=f"97800000{Book.objects.count():05d}", status=Book.Status.APPROVED,
            price=price, seller_share=share, uploaded_by=uploader or self.seller, book_file="books/files/x.pdf",
        )

    def test_purchase_legs_sum_to_zero_and_move_the_money(self):
        legs = services.purchase_legs(services.wallet_of(self.buyer), self.book(80_000, 60_000))
        entries = services.transfer(legs, "خرید کتاب x")
        self.assertEqual(sum(e.amount for e in entries), 0)
        self.assertEqual(len({e.group for e in entries}), 1)
        self.assertEqual(balance(self.buyer), 20_000)
        self.assertEqual(balance(self.seller), 60_000)
        self.assertEqual(services.balance_of(services.platform_wallet()), 20_000)

    def test_insufficient_balance_writes_nothing(self):
        before = LedgerEntry.objects.count()
        legs = services.purchase_legs(services.wallet_of(self.buyer), self.book(150_000, 100_000))
        with self.assertRaises(services.WalletError) as ctx:
            services.transfer(legs)
        self.assertEqual(ctx.exception.message, services.INSUFFICIENT_BALANCE)
        self.assertEqual(LedgerEntry.objects.count(), before)
        self.assertEqual(balance(self.buyer), 100_000)

    def test_admin_book_has_no_seller_leg_and_free_book_no_legs(self):
        admin_book = self.book(30_000, 0, uploader=self.admin)
        legs = services.purchase_legs(services.wallet_of(self.buyer), admin_book)
        self.assertEqual([leg[2] for leg in legs], ["purchase", "commission"])
        self.assertEqual(services.purchase_legs(services.wallet_of(self.buyer), self.book(0, 0)), [])

    def test_legs_must_sum_to_zero(self):
        with self.assertRaises(ValueError):
            services.transfer([
                (services.wallet_of(self.buyer), -10, LedgerEntry.Type.PURCHASE),
                (services.wallet_of(self.seller), 9, LedgerEntry.Type.SALE_INCOME),
            ])

    def test_platform_wallet_balance_is_total_commission(self):
        for _ in range(2):
            legs = services.purchase_legs(services.wallet_of(self.buyer), self.book(30_000, 20_000))
            services.transfer(legs)
        self.assertEqual(services.balance_of(services.platform_wallet()), 20_000)


# ---------------------------------------------------------------------------
# Concurrency: real database transactions, real threads, real row locks
# ---------------------------------------------------------------------------

class ConcurrencyTests(TransactionTestCase):
    """TestCase wraps every test in one transaction that's never committed, so locks
    from different threads never meet. TransactionTestCase commits for real, and
    each thread has its own database connection, like two real requests."""

    def setUp(self):
        self.admin = make_admin()
        self.buyer = make_user("buyer@example.com")
        self.seller = make_user("seller@example.com")
        fund(self.buyer, 100_000, self.admin)

    def run_together(self, *calls):
        """Start all calls at the same moment in separate threads; return [result or error]."""
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

    def test_two_transfers_over_the_balance_cannot_both_succeed(self):
        book = Book.objects.create(
            title="x", isbn="9780000000001", status=Book.Status.APPROVED, price=80_000, seller_share=60_000,
            uploaded_by=self.seller, book_file="books/files/x.pdf",
        )
        buyer_wallet = services.wallet_of(self.buyer)

        def buy():
            return services.transfer(services.purchase_legs(buyer_wallet, book))

        results = self.run_together(buy, buy)
        errors = [r for r in results if isinstance(r, Exception)]
        self.assertEqual(len(errors), 1, results)
        self.assertIsInstance(errors[0], services.WalletError)
        self.assertEqual(balance(self.buyer), 20_000)
        self.assertEqual(balance(self.seller), 60_000)

    def test_two_negative_adjustments_over_the_balance_cannot_both_succeed(self):
        wallet = services.wallet_of(self.buyer)
        results = self.run_together(
            lambda: services.adjust(wallet, -80_000, "x", self.admin),
            lambda: services.adjust(wallet, -80_000, "x", self.admin),
        )
        self.assertEqual(sum(isinstance(r, services.WalletError) for r in results), 1, results)
        self.assertEqual(balance(self.buyer), 20_000)

    def test_two_withdrawals_at_once_only_one_succeeds(self):
        results = self.run_together(
            lambda: services.create_withdrawal(self.buyer, 80_000, VALID_CARD),
            lambda: services.create_withdrawal(self.buyer, 80_000, VALID_CARD),
        )
        self.assertEqual(sum(isinstance(r, services.WalletError) for r in results), 1, results)
        self.assertEqual(WithdrawalRequest.objects.count(), 1)
        self.assertEqual(balance(self.buyer), 20_000)

    def test_approving_the_same_topup_twice_at_once_credits_once(self):
        request = topup_request(self.seller, amount=50_000, tracking="RACE1")
        results = self.run_together(
            lambda: services.approve_topup(request, self.admin),
            lambda: services.approve_topup(request, self.admin),
        )
        self.assertEqual(sum(isinstance(r, services.WalletError) for r in results), 1, results)
        self.assertEqual(balance(self.seller), 50_000)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class WalletApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("a@example.com")
        self.other = make_user("b@example.com")
        self.client.force_authenticate(self.user)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        for url in ["/wallet/", "/wallet/transactions/", "/wallet/topup-requests/", "/wallet/withdrawals/"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_401_UNAUTHORIZED)

    @override_settings(MEGABOOK_CARD_NUMBER="6037991234567890", MEGABOOK_CARD_HOLDER="مگابوک")
    def test_wallet_summary(self):
        fund(self.user, 25_000, self.admin)
        fund(self.other, 99_000, self.admin)
        data = self.client.get("/wallet/").data
        self.assertEqual(data["balance"], 25_000)
        self.assertEqual(data["topup_card"], {"number": "6037991234567890", "holder": "مگابوک"})

    def test_transactions_only_mine_and_filtered(self):
        fund(self.user, 50_000, self.admin)
        services.create_withdrawal(self.user, 10_000, VALID_CARD)
        fund(self.other, 99_000, self.admin)

        data = self.client.get("/wallet/transactions/").data
        self.assertEqual(data["count"], 2)
        self.assertEqual([t["type"] for t in data["results"]], ["withdrawal", "topup"])
        self.assertEqual(data["results"][1]["source"], "card_to_card")

        topups = self.client.get("/wallet/transactions/", {"type": "topup"}).data
        self.assertEqual([t["amount"] for t in topups["results"]], [50_000])
        self.assertEqual(self.client.get("/wallet/transactions/", {"type": "x"}).status_code, 400)

    @override_settings(DEBUG=True)
    def test_mock_topup_with_debug(self):
        res = self.client.post("/wallet/mock-topup/", {"amount": 75_000}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["balance"], 75_000)
        self.assertEqual(GatewayPayment.objects.get().status, GatewayPayment.Status.PAID)
        entry = self.client.get("/wallet/transactions/").data["results"][0]
        self.assertEqual((entry["type"], entry["source"]), ("topup", "gateway"))

    @override_settings(DEBUG=True)
    def test_mock_topup_rejects_bad_amounts(self):
        for amount in (0, -5, "abc"):
            res = self.client.post("/wallet/mock-topup/", {"amount": amount}, format="json")
            self.assertEqual(res.status_code, 400)
        self.assertEqual(balance(self.user), 0)

    @override_settings(DEBUG=False)
    def test_mock_topup_is_404_without_debug(self):
        self.assertEqual(self.client.post("/wallet/mock-topup/", {"amount": 75_000}, format="json").status_code, 404)
        # Same 404 even without login: nothing reveals that the endpoint exists
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post("/wallet/mock-topup/", {"amount": 75_000}, format="json").status_code, 404)
        self.assertEqual(balance(self.user), 0)

    def test_create_topup_request(self):
        res = self.client.post("/wallet/topup-requests/", {
            "amount": "120000", "tracking_number": "۹۸۷ ۶۵۴",
            "deposited_at": (timezone.now() - timedelta(hours=2)).isoformat(), "receipt": png_file(),
        }, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["tracking_number"], "987654")
        self.assertEqual(res.data["status"], "pending")
        # Not money yet: only an admin's approval credits the wallet
        self.assertEqual(balance(self.user), 0)

    def test_duplicate_tracking_number_api_error(self):
        topup_request(self.other, tracking="987654")
        res = self.client.post("/wallet/topup-requests/", {
            "amount": 1000, "tracking_number": "۹۸۷-۶۵۴", "deposited_at": timezone.now().isoformat(),
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["tracking_number"], ["این شماره پیگیری قبلاً ثبت شده است."])

    def test_topup_request_errors_are_persian(self):
        res = self.client.post("/wallet/topup-requests/", {}, format="json")
        self.assertEqual(res.data["amount"], ["مبلغ را وارد کنید."])
        self.assertEqual(res.data["tracking_number"], ["شماره پیگیری واریز را وارد کنید."])
        self.assertEqual(res.data["deposited_at"], ["زمان واریز را وارد کنید."])

    def test_create_withdrawal_and_masked_card(self):
        fund(self.user, 50_000, self.admin)
        res = self.client.post("/wallet/withdrawals/", {"amount": 20_000, "card_number": VALID_CARD}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertNotIn(VALID_CARD, str(res.data))
        self.assertEqual(res.data["card_number"], f"{VALID_CARD[:4]} {VALID_CARD[4:6]}** **** {VALID_CARD[12:]}")
        self.assertEqual(balance(self.user), 30_000)
        listed = self.client.get("/wallet/withdrawals/").data["results"]
        self.assertNotIn(VALID_CARD, str(listed))

    def test_withdrawal_api_errors(self):
        fund(self.user, 50_000, self.admin)
        res = self.client.post("/wallet/withdrawals/", {"amount": 60_000, "card_number": VALID_CARD}, format="json")
        self.assertEqual(res.data["amount"], [services.INSUFFICIENT_BALANCE])
        res = self.client.post("/wallet/withdrawals/", {"amount": 1_000, "card_number": "1234"}, format="json")
        self.assertEqual(res.data["card_number"], [CARD_LENGTH])
        self.client.post("/wallet/withdrawals/", {"amount": 1_000, "card_number": VALID_CARD}, format="json")
        res = self.client.post("/wallet/withdrawals/", {"amount": 1_000, "card_number": VALID_CARD}, format="json")
        self.assertEqual(res.data["non_field_errors"], [services.PENDING_WITHDRAWAL_EXISTS])

    def test_requests_lists_show_only_mine(self):
        topup_request(self.other, tracking="OTHER1")
        fund(self.other, 10_000, self.admin)
        services.create_withdrawal(self.other, 5_000, VALID_CARD)
        topup_request(self.user, tracking="MINE1")
        self.assertEqual(
            [r["tracking_number"] for r in self.client.get("/wallet/topup-requests/").data["results"]], ["MINE1"]
        )
        self.assertEqual(self.client.get("/wallet/withdrawals/").data["count"], 0)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

class WalletAdminTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("a@example.com")
        self.client.force_login(self.admin)

    def action(self, url, name, ids, **extra):
        return self.client.post(url, {"action": name, "_selected_action": ids, **extra})

    def test_approve_and_reject_topups(self):
        a = topup_request(self.user, amount=10_000, tracking="A1")
        b = topup_request(self.user, amount=20_000, tracking="B1")
        url = "/admin/wallet/topuprequest/"
        self.action(url, "approve_selected", [a.pk])
        self.assertEqual(balance(self.user), 10_000)

        # Reject asks for a reason first, then applies
        res = self.action(url, "reject_selected", [b.pk])
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "دلیل")
        self.action(url, "reject_selected", [b.pk], apply="1", reason="رسید پیدا نشد")
        b.refresh_from_db()
        self.assertEqual((b.status, b.rejection_reason), ("rejected", "رسید پیدا نشد"))
        self.assertEqual(balance(self.user), 10_000)

        # Approving again changes nothing
        self.action(url, "approve_selected", [a.pk])
        self.assertEqual(balance(self.user), 10_000)

    def test_complete_and_reject_withdrawals(self):
        fund(self.user, 50_000, self.admin)
        w = services.create_withdrawal(self.user, 20_000, VALID_CARD)
        url = "/admin/wallet/withdrawalrequest/"
        res = self.client.get(url)
        self.assertContains(res, "Sara Ahmadi")
        self.assertContains(res, " ".join(VALID_CARD[i:i + 4] for i in range(0, 16, 4)))
        self.action(url, "reject_selected", [w.pk], apply="1", reason="کارت به نام کاربر نیست")
        self.assertEqual(balance(self.user), 50_000)

        w2 = services.create_withdrawal(self.user, 20_000, VALID_CARD)
        self.action(url, "complete_selected", [w2.pk])
        w2.refresh_from_db()
        self.assertEqual(w2.status, "completed")
        self.assertEqual(balance(self.user), 30_000)

    def test_ledger_entries_are_read_only(self):
        fund(self.user, 5_000, self.admin)
        entry = LedgerEntry.objects.get()
        url = f"/admin/wallet/ledgerentry/{entry.pk}/change/"
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.post(url, {"amount": 1})
        self.assertEqual(LedgerEntry.objects.get().amount, 5_000)
        self.assertEqual(self.client.get("/admin/wallet/ledgerentry/add/").status_code, 403)
        self.assertEqual(self.client.post(f"/admin/wallet/ledgerentry/{entry.pk}/delete/", {"post": "yes"}).status_code, 403)

    def test_wallet_list_shows_balances_including_platform(self):
        fund(self.user, 12_345, self.admin)
        res = self.client.get("/admin/wallet/wallet/")
        self.assertContains(res, "12,345 تومان")
        self.assertContains(res, "کیف پول مگابوک")

    def test_manual_adjustment_page(self):
        wallet = services.wallet_of(self.user)
        url = f"/admin/wallet/wallet/{wallet.pk}/adjust/"
        self.assertEqual(self.client.get(url).status_code, 200)
        res = self.client.post(url, {"amount": "-1", "description": "x"})
        self.assertContains(res, services.INSUFFICIENT_BALANCE)
        self.client.post(url, {"amount": "3000", "description": "جبران"})
        self.assertEqual(balance(self.user), 3_000)
        self.assertEqual(LedgerEntry.objects.get().created_by, self.admin)


class ReceiptPrivacyTests(APITestCase):
    """Top-up receipts: private storage, owner and admins only, never a URL in the API."""

    def setUp(self):
        self.admin = make_admin()
        self.owner = make_user("owner@example.com")
        self.other = make_user("other@example.com")
        self.client.force_authenticate(self.owner)
        res = self.client.post("/wallet/topup-requests/", {
            "amount": "10000", "tracking_number": "R1",
            "deposited_at": (timezone.now() - timedelta(hours=1)).isoformat(), "receipt": png_file(),
        }, format="multipart")
        self.assertEqual(res.status_code, 201, res.data)
        self.response = res.data
        self.topup = TopUpRequest.objects.get()

    def link(self, user):
        self.client.force_authenticate(user)
        return self.client.get(f"/wallet/topup-requests/{self.topup.pk}/receipt-link/")

    def test_api_returns_no_file_url(self):
        self.assertNotIn("receipt", self.response)
        self.assertTrue(self.response["has_receipt"])
        listed = self.client.get("/wallet/topup-requests/").data["results"][0]
        self.assertNotIn("receipt", listed)
        self.assertNotIn("/media/", str(listed))

    def test_stored_privately_with_a_random_name(self):
        name = self.topup.receipt.name
        self.assertTrue(name.startswith("wallet/receipts/"))
        self.assertNotIn("receipt.png", name)
        path = Path(self.topup.receipt.path).resolve()
        self.assertTrue(path.is_relative_to(Path(settings.PRIVATE_MEDIA_ROOT).resolve()))
        with self.assertRaises(ValueError):
            self.topup.receipt.url

    def test_owner_link_works_without_jwt(self):
        url = self.link(self.owner).data["url"]
        self.client.force_authenticate(None)
        res = self.client.get(url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/png")

    def test_other_user_gets_404(self):
        self.assertEqual(self.link(self.other).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/wallet/topup-requests/{self.topup.pk}/receipt/").status_code, 404)

    def test_book_token_cannot_open_a_receipt(self):
        # Different salts per kind: a valid token for one kind is garbage for the other
        from MegaBook_Backend import private_files

        token = private_files._signer("book-file").sign_object({"o": self.topup.pk, "u": self.owner.pk})
        self.client.force_authenticate(None)
        res = self.client.get(f"/wallet/topup-requests/{self.topup.pk}/receipt/?t={token}")
        self.assertEqual(res.status_code, 404)

    def test_admin_page_links_through_the_view(self):
        self.client.force_authenticate(None)
        self.client.force_login(self.admin)
        page = self.client.get("/admin/wallet/topuprequest/")
        self.assertContains(page, f"/wallet/topup-requests/{self.topup.pk}/receipt/")
        self.assertEqual(self.client.get(f"/wallet/topup-requests/{self.topup.pk}/receipt/").status_code, 200)

    def test_admin_change_page_opens(self):
        self.client.force_authenticate(None)
        self.client.force_login(self.admin)
        res = self.client.get(f"/admin/wallet/topuprequest/{self.topup.pk}/change/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, f"/wallet/topup-requests/{self.topup.pk}/receipt/")
