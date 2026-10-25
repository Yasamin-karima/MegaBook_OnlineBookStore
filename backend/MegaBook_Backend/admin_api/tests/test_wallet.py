import threading

from django.db import connection
from rest_framework.test import APIClient, APITransactionTestCase

from notifications.models import Notification
from wallet import services as wallet_services
from wallet.models import LedgerEntry, TopUpRequest

from .helpers import AdminApiTestCase, Make, balance


class TopupTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = Make.user("nima")
        self.topup = Make.topup(self.user, 200_000)
        self.base = f"/admin-api/wallet/topups/{self.topup.pk}/"

    def test_list_pending_with_balance_and_counts(self):
        Make.fund(self.user, 5_000, self.admin)
        data = self.client.get("/admin-api/wallet/topups/").data
        row = data["results"][0]
        self.assertEqual((row["id"], row["user"]["balance"], row["tracking_number"]), (self.topup.pk, 5_000, self.topup.tracking_number))
        self.assertEqual(data["pending"], {"topups": 1, "withdrawals": 0})
        self.assertEqual(self.client.get("/admin-api/wallet/topups/", {"search": self.topup.tracking_number}).data["count"], 1)

    def test_approve_credits_exactly_once_and_is_final(self):
        response = self.client.post(f"{self.base}approve/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.data["status"], response.data["reviewed_by"]), ("approved", "admin مدیر"))
        self.assertEqual(balance(self.user), 200_000)
        # A second decision, either way, is refused and changes nothing
        self.assertEqual(self.client.post(f"{self.base}approve/").status_code, 409)
        self.assertEqual(self.client.post(f"{self.base}reject/", {"reason": "x"}).status_code, 409)
        self.assertEqual(balance(self.user), 200_000)
        self.assertEqual(LedgerEntry.objects.filter(topup_request=self.topup).count(), 1)
        self.assertTrue(Notification.objects.filter(recipient=self.user, type=Notification.Type.TOPUP_APPROVED).exists())

    def test_reject_needs_reason_and_moves_no_money(self):
        self.assertEqual(self.client.post(f"{self.base}reject/", {"reason": " "}).status_code, 400)
        response = self.client.post(f"{self.base}reject/", {"reason": "در صورت‌حساب پیدا نشد"})
        self.assertEqual((response.status_code, response.data["rejection_reason"]), (200, "در صورت‌حساب پیدا نشد"))
        self.assertEqual(balance(self.user), 0)
        self.assertEqual(self.client.post(f"{self.base}approve/").status_code, 409)


class WithdrawalTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = Make.user("reza")
        Make.fund(self.user, 300_000, self.admin)
        self.withdrawal = wallet_services.create_withdrawal(self.user, 250_000, "6037991123456786")
        self.base = f"/admin-api/wallet/withdrawals/{self.withdrawal.pk}/"

    def test_list_shows_full_card_for_payout(self):
        row = self.client.get("/admin-api/wallet/withdrawals/").data["results"][0]
        self.assertEqual((row["card_number"], row["user"]["balance"]), ("6037991123456786", 50_000))

    def test_rejection_creates_the_reversal(self):
        self.assertEqual(self.client.post(f"{self.base}reject/", {}).status_code, 400)
        response = self.client.post(f"{self.base}reject/", {"reason": "کارت به نام شما نیست"})
        self.assertEqual((response.status_code, response.data["status"]), (200, "rejected"))
        reversal = LedgerEntry.objects.get(withdrawal_request=self.withdrawal, type=LedgerEntry.Type.WITHDRAWAL_REVERSAL)
        self.assertEqual(reversal.amount, 250_000)
        self.assertEqual(balance(self.user), 300_000)
        self.assertEqual(self.client.post(f"{self.base}complete/").status_code, 409)

    def test_complete_adds_nothing_to_the_ledger_and_is_final(self):
        before = LedgerEntry.objects.count()
        response = self.client.post(f"{self.base}complete/")
        self.assertEqual((response.status_code, response.data["status"]), (200, "completed"))
        self.assertEqual(LedgerEntry.objects.count(), before)
        self.assertEqual(self.client.post(f"{self.base}reject/", {"reason": "x"}).status_code, 409)
        self.assertEqual(self.client.get("/admin-api/wallet/withdrawals/?status=completed").data["count"], 1)


class AdjustmentTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = Make.user("maryam")
        Make.fund(self.user, 10_000, self.admin)

    def post(self, **data):
        return self.client.post("/admin-api/wallet/adjustments/", {"user_id": self.user.pk, **data}, format="json")

    def test_adjustment_records_admin_and_returns_new_balance(self):
        response = self.post(amount=-4_000, description="جبران خطای قیمت")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["balance"], 6_000)
        self.assertEqual(response.data["adjustment"]["created_by"], "admin مدیر")
        entry = LedgerEntry.objects.get(pk=response.data["adjustment"]["id"])
        self.assertEqual((entry.type, entry.created_by), (LedgerEntry.Type.ADJUSTMENT, self.admin))
        listed = self.client.get("/admin-api/wallet/adjustments/").data["results"]
        self.assertEqual(listed[0]["id"], entry.pk)

    def test_cannot_make_a_balance_negative(self):
        response = self.post(amount=-10_001, description="اشتباه")
        self.assertEqual(response.status_code, 400)
        self.assertIn("amount", response.data)
        self.assertEqual(balance(self.user), 10_000)

    def test_description_required_and_zero_refused(self):
        self.assertIn("description", self.post(amount=1_000, description="  ").data)
        self.assertIn("amount", self.post(amount=0, description="x").data)
        response = self.client.post(
            "/admin-api/wallet/adjustments/", {"user_id": 999_999, "amount": 1, "description": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 400)


class ConcurrentTopupDecisionTests(APITransactionTestCase):
    """Two admins approve the same top-up at the same moment: one credits, the other
    gets 409, and the wallet is credited exactly once. Real threads and a real
    PostgreSQL, so the row locks actually meet (a TestCase keeps everything in one
    transaction and they never would)."""

    def setUp(self):
        self.admins = [Make.admin("first"), Make.admin("second")]
        self.user = Make.user("concurrent")

    def race(self, topup, actions):
        """Both admins decide `topup` at the same moment; returns the two status codes."""
        barrier = threading.Barrier(len(actions))
        codes = []

        def decide(admin, action):
            client = APIClient()
            client.force_authenticate(admin)
            data = {"reason": "رد هم‌زمان"} if action == "reject" else {}
            barrier.wait()
            try:
                codes.append(client.post(f"/admin-api/wallet/topups/{topup.pk}/{action}/", data).status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=decide, args=pair) for pair in zip(self.admins, actions)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return sorted(codes)

    def test_two_concurrent_approvals_credit_once(self):
        topup = Make.topup(self.user, 70_000)
        self.assertEqual(self.race(topup, ("approve", "approve")), [200, 409])
        self.assertEqual(LedgerEntry.objects.filter(topup_request=topup).count(), 1)
        self.assertEqual(balance(self.user), 70_000)

    def test_concurrent_approve_and_reject_leave_one_decision(self):
        topup = Make.topup(self.user, 70_000)
        self.assertEqual(self.race(topup, ("approve", "reject")), [200, 409])
        topup.refresh_from_db()
        credited = LedgerEntry.objects.filter(topup_request=topup).count()
        # Whichever won, the money matches the final status
        self.assertEqual(credited, 1 if topup.status == TopUpRequest.Status.APPROVED else 0)
        self.assertEqual(balance(self.user), 70_000 * credited)
