from datetime import timedelta
from io import StringIO

from django.contrib.admin import helpers
from django.forms import FileField
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import transaction
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from book_requests import services as request_services
from book_requests.models import BookRequest, RequestEntry
from cart import services as cart_services
from catalog.models import Book, Person
from orders import services as order_services
from orders.tests import BookFactory, fund
from reviews.models import Review
from support import services as support_services
from support.models import Conversation
from wallet import services as wallet_services
from wallet.models import TopUpRequest, WithdrawalRequest
from wallet.tests import VALID_CARD

from . import services
from .models import RETENTION_DAYS, Notification

User = get_user_model()
Type = Notification.Type
PASSWORD = "Str0ng-Passw0rd!"


def make_user(email, first="سارا", last="جعفری"):
    return User.objects.create_user(email=email, first_name=first, last_name=last, password=PASSWORD)


def make_admin(email):
    return User.objects.create_superuser(email=email, first_name="مدیر", last_name="سایت", password=PASSWORD)


def of(user, type=None):
    queryset = Notification.objects.filter(recipient=user)
    return queryset.filter(type=type) if type else queryset


def admin_form_data(client, url):
    """The POST data of an admin change form exactly as it is now (fields and inlines),
    so a test can change one field and submit it like an admin would."""
    res = client.get(url)
    form = res.context["adminform"].form
    data = {}
    for name, field in form.fields.items():
        # A browser sends no file when none is chosen: the form keeps the stored one
        if isinstance(field, FileField):
            continue
        value = form[name].value()
        if value is not None:
            data[name] = value
    for inline in res.context["inline_admin_formsets"]:
        formset = inline.formset
        for name in formset.management_form.fields:
            data[f"{formset.prefix}-{name}"] = formset.management_form[name].value()
        for subform in formset.forms:
            for name in subform.fields:
                value = subform[name].value()
                if value is not None:
                    data[subform.add_prefix(name)] = value
    return data


class NotificationTestBase(APITestCase):
    def setUp(self):
        self.admin = make_admin("admin1@example.com")
        self.admin2 = make_admin("admin2@example.com")
        self.uploader = make_user("uploader@example.com", "رضا", "کریمی")
        self.buyer = make_user("buyer@example.com")
        self.other = make_user("other@example.com", "علی", "رضایی")

    def pending_book(self):
        """A user's upload waiting for review, complete enough for the admin form."""
        book = BookFactory.make(self.uploader, price=None, book_status=Book.Status.PENDING)
        book.authors.add(Person.objects.get_or_create(name="نویسنده")[0])
        return book

    def admin_change(self, model_admin_name, obj, **changes):
        """Submit obj's admin change form with some fields changed."""
        self.client.force_login(self.admin)
        url = reverse(f"admin:{model_admin_name}_change", args=[obj.pk])
        data = admin_form_data(self.client, url)
        data.update(changes)
        res = self.client.post(url, data)
        self.assertEqual(res.status_code, 302, getattr(res, "context", None) and res.context["adminform"].form.errors)
        self.client.logout()

    def staff_counts(self, type):
        return [of(self.admin, type).count(), of(self.admin2, type).count()]


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------

class UploadTests(NotificationTestBase):
    def test_new_upload_notifies_every_admin_not_the_uploader(self):
        book = BookFactory.make(self.uploader, price=None, book_status=Book.Status.PENDING)
        self.assertEqual(self.staff_counts(Type.STAFF_NEW_UPLOAD), [1, 1])
        self.assertEqual(of(self.admin).get().book, book)
        self.assertFalse(of(self.uploader).exists())

    def test_admins_own_upload_is_approved_at_once_and_notifies_nobody(self):
        BookFactory.make(self.admin)
        self.assertFalse(Notification.objects.exists())

    def test_approve_in_admin_then_edit_price_notifies_once(self):
        book = self.pending_book()
        self.admin_change("catalog_book", book, status="approved", price="80000")
        self.assertEqual(of(self.uploader, Type.UPLOAD_APPROVED).count(), 1)
        # Editing an approved book (no status change) notifies nobody again
        self.admin_change("catalog_book", book, price="90000")
        book.refresh_from_db()
        self.assertEqual(book.price, 90000)
        self.assertEqual(of(self.uploader).count(), 1)

    def test_reject_links_to_the_upload_conversation(self):
        book = self.pending_book()
        self.admin_change("catalog_book", book, status="rejected", rejection_reason="فایل ناقص است")
        n = of(self.uploader, Type.UPLOAD_REJECTED).get()
        self.client.force_authenticate(self.uploader)
        item = self.client.get(reverse("notifications")).data["results"][0]
        self.assertEqual(item["link"], {"kind": "app", "path": f"/uploads/{book.pk}"})
        self.assertIn(book.title, item["text"])
        # The reason travels with the notification and is shown in its text
        self.assertEqual(n.params, {"title": book.title, "reason": "فایل ناقص است"})
        self.assertIn("فایل ناقص است", item["text"])


# ---------------------------------------------------------------------------
# Book requests
# ---------------------------------------------------------------------------

class RequestTests(NotificationTestBase):
    ISBN = "9780306406157"

    def submit(self, user):
        with transaction.atomic():
            return request_services.submit_request(user, isbn=self.ISBN, title="کتاب درخواستی")

    def test_only_the_first_request_of_an_isbn_notifies_staff(self):
        self.submit(self.buyer)
        self.submit(self.other)  # joins the same BookRequest
        self.assertEqual(self.staff_counts(Type.STAFF_NEW_REQUEST), [1, 1])
        self.assertEqual(of(self.admin).get().book_request, BookRequest.objects.get())

    def test_rejected_in_admin_notifies_every_requester_with_reason_once(self):
        self.submit(self.buyer)
        self.submit(self.other)
        book_request = BookRequest.objects.get()
        self.admin_change("book_requests_bookrequest", book_request, status="rejected", rejection_reason="کتاب ممنوع است")
        for user in (self.buyer, self.other):
            n = of(user, Type.REQUEST_REJECTED).get()
            self.assertEqual(n.request_entry, RequestEntry.objects.get(requester=user))
            self.assertEqual(n.params["reason"], "کتاب ممنوع است")
        # Saving the form again (no status change) adds nothing
        self.admin_change("book_requests_bookrequest", book_request, title="عنوان اصلاح‌شده")
        self.assertEqual(Notification.objects.filter(type=Type.REQUEST_REJECTED).count(), 2)

    def test_fulfilled_by_approving_a_book_reveals_nothing_about_others(self):
        self.submit(self.buyer)
        self.submit(self.other)
        book = self.pending_book()
        book.isbn = self.ISBN
        book.save()
        self.admin_change("catalog_book", book, status="approved", price="50000")
        self.client.force_authenticate(self.buyer)
        item = self.client.get(reverse("notifications")).data["results"][0]
        self.assertEqual(item["type"], Type.REQUEST_FULFILLED)
        self.assertEqual(item["link"], {"kind": "app", "path": f"/books/{book.pk}"})
        # No count of requesters, no uploader
        for leak in ("۲", "2", "رضا", "کریمی", self.uploader.email):
            self.assertNotIn(leak, item["text"])
        self.assertEqual(Notification.objects.filter(type=Type.REQUEST_FULFILLED).count(), 2)


# ---------------------------------------------------------------------------
# Support conversations
# ---------------------------------------------------------------------------

class ConversationTests(NotificationTestBase):
    def setUp(self):
        super().setUp()
        self.book = BookFactory.make(self.uploader, price=None, book_status=Book.Status.PENDING)
        Notification.objects.all().delete()  # the "new upload" ones

    def reply(self, admin=None):
        support_services.post_support_message(admin or self.admin, self.book, "پاسخ پشتیبانی")

    def user_writes(self):
        support_services.post_user_message(self.uploader, self.book, "سؤال من")

    def test_one_unread_support_reply_per_conversation(self):
        self.reply()
        self.reply(self.admin2)
        self.assertEqual(of(self.uploader, Type.SUPPORT_REPLY).count(), 1)
        # Opening the conversation (however the user got there) reads it
        self.client.force_authenticate(self.uploader)
        self.client.get(reverse("support_upload", args=[self.book.pk]))
        self.assertIsNotNone(of(self.uploader).get().read_at)
        # The next reply is a new notification
        self.reply()
        self.assertEqual(of(self.uploader, Type.SUPPORT_REPLY).count(), 2)
        self.assertEqual(of(self.uploader).filter(read_at__isnull=True).count(), 1)
        link = self.client.get(reverse("notifications")).data["results"][0]["link"]
        self.assertEqual(link, {"kind": "app", "path": f"/uploads/{self.book.pk}"})

    def test_read_endpoint_and_writing_also_read_it(self):
        self.reply()
        self.client.force_authenticate(self.uploader)
        self.client.post(reverse("support_upload_read", args=[self.book.pk]))
        self.assertIsNotNone(of(self.uploader).get().read_at)
        self.reply()
        self.user_writes()  # writing means having read
        self.assertFalse(of(self.uploader).filter(read_at__isnull=True).exists())

    def test_one_unread_user_message_per_conversation_per_admin(self):
        self.user_writes()
        self.user_writes()
        self.assertEqual(self.staff_counts(Type.STAFF_USER_MESSAGE), [1, 1])
        # Admin 1 opens the conversation in the admin: only their copy is read
        self.client.force_login(self.admin)
        conversation = Conversation.objects.get()
        self.client.get(reverse("admin:support_conversation_change", args=[conversation.pk]))
        self.assertIsNotNone(of(self.admin).get().read_at)
        self.assertIsNone(of(self.admin2).get().read_at)
        self.user_writes()
        self.assertEqual(self.staff_counts(Type.STAFF_USER_MESSAGE), [2, 1])
        # Replying counts as reading for that admin
        self.reply(self.admin2)
        self.assertFalse(of(self.admin2).filter(read_at__isnull=True).exists())

    def test_system_messages_are_not_support_replies(self):
        self.book.status = Book.Status.REJECTED
        self.book.rejection_reason = "فایل ناقص"
        self.book.save()
        self.assertFalse(of(self.uploader, Type.SUPPORT_REPLY).exists())
        self.assertEqual(of(self.uploader, Type.UPLOAD_REJECTED).count(), 1)


# ---------------------------------------------------------------------------
# Wallet
# ---------------------------------------------------------------------------

class WalletTests(NotificationTestBase):
    def topup(self):
        self.client.force_authenticate(self.buyer)
        res = self.client.post(reverse("wallet_topup_requests"), {
            "amount": 120000, "tracking_number": f"T{TopUpRequest.objects.count()}",
            "deposited_at": (timezone.now() - timedelta(hours=1)).isoformat(),
        }, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return TopUpRequest.objects.get(pk=res.data["id"])

    def admin_action(self, model, action, objs, **extra):
        self.client.force_login(self.admin)
        self.client.post(reverse(f"admin:wallet_{model}_changelist"),
                         {"action": action, helpers.ACTION_CHECKBOX_NAME: [o.pk for o in objs], **extra})
        self.client.logout()

    def test_topup_request_approved_and_rejected(self):
        first = self.topup()
        self.assertEqual(self.staff_counts(Type.STAFF_NEW_TOPUP), [1, 1])
        self.admin_action("topuprequest", "approve_selected", [first])
        n = of(self.buyer, Type.TOPUP_APPROVED).get()
        self.assertEqual((n.topup_request, n.params["amount"]), (first, 120000))

        second = self.topup()
        self.admin_action("topuprequest", "reject_selected", [second], apply="1", reason="رسید خوانا نیست")
        self.assertEqual(of(self.buyer, Type.TOPUP_REJECTED).get().params["reason"], "رسید خوانا نیست")
        self.client.force_authenticate(self.buyer)
        texts = [r["text"] for r in self.client.get(reverse("notifications")).data["results"]]
        self.assertIn("۱۲۰٬۰۰۰ تومان", texts[0])

    def test_withdrawal_completed_and_rejected(self):
        fund(self.buyer, 100_000, self.admin)
        self.client.force_authenticate(self.buyer)
        res = self.client.post(reverse("wallet_withdrawals"), {"amount": 30000, "card_number": VALID_CARD}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        first = WithdrawalRequest.objects.get()
        self.assertEqual(self.staff_counts(Type.STAFF_NEW_WITHDRAWAL), [1, 1])
        self.admin_action("withdrawalrequest", "complete_selected", [first])
        self.assertEqual(of(self.buyer, Type.WITHDRAWAL_COMPLETED).get().withdrawal_request, first)

        second = wallet_services.create_withdrawal(self.buyer, 20000, VALID_CARD)
        with transaction.atomic():
            wallet_services.reject_withdrawal(second, self.admin, "شماره کارت به نام شما نیست")
        self.assertEqual(of(self.buyer, Type.WITHDRAWAL_REJECTED).get().params["reason"], "شماره کارت به نام شما نیست")

    @override_settings(DEBUG=True)
    def test_mock_topup_notifies_nobody(self):
        self.client.force_authenticate(self.buyer)
        self.assertEqual(self.client.post(reverse("wallet_mock_topup"), {"amount": 5000}, format="json").status_code, 201)
        self.assertFalse(Notification.objects.exists())


# ---------------------------------------------------------------------------
# Sales, reviews
# ---------------------------------------------------------------------------

class SaleTests(NotificationTestBase):
    def buy(self, *books):
        for book in books:
            cart_services.add(self.buyer, book.pk)
        return order_services.checkout(self.buyer)

    def test_one_notification_per_sale_with_the_share(self):
        book1 = BookFactory.make(self.uploader, price=50_000, share=30_000, title="کتاب یک")
        book2 = BookFactory.make(self.uploader, price=20_000, share=10_000, title="کتاب دو")
        fund(self.buyer, 100_000, self.admin)
        self.buy(book1, book2)
        sales = of(self.uploader, Type.SALE_INCOME).order_by("id")
        self.assertEqual([(n.book, n.params["amount"]) for n in sales], [(book1, 30_000), (book2, 10_000)])
        self.assertIsNotNone(sales[0].order_item)
        self.assertFalse(of(self.buyer).exists())

    def test_no_notification_without_money_for_the_uploader(self):
        admins_book = BookFactory.make(self.admin, price=40_000, share=0)
        free_user_book = BookFactory.make(self.uploader, price=0, share=0)
        fund(self.buyer, 100_000, self.admin)
        self.buy(admins_book, free_user_book)
        self.assertFalse(Notification.objects.filter(type=Type.SALE_INCOME).exists())

    def test_rolled_back_checkout_leaves_no_notification(self):
        book = BookFactory.make(self.uploader, price=50_000, share=30_000)
        cart_services.add(self.buyer, book.pk)
        with self.assertRaises(order_services.CheckoutError):
            order_services.checkout(self.buyer)  # no money: the whole purchase rolls back
        self.assertFalse(Notification.objects.exists())

    def test_rolled_back_event_leaves_no_notification(self):
        book = BookFactory.make(self.uploader, price=None, book_status=Book.Status.PENDING)
        Notification.objects.all().delete()
        try:
            with transaction.atomic():
                book.status = Book.Status.REJECTED
                book.rejection_reason = "فایل ناقص"
                book.save()
                self.assertTrue(of(self.uploader).exists())
                raise RuntimeError("the admin action failed after the save")
        except RuntimeError:
            pass
        self.assertFalse(Notification.objects.exists())


class ReviewTests(NotificationTestBase):
    def test_hidden_review_notifies_its_author_with_the_reason(self):
        book = BookFactory.make(self.uploader)
        review = Review.objects.create(user=self.buyer, book=book, rating=2, body="متن")
        review.hide(self.admin, "توهین‌آمیز")
        n = of(self.buyer, Type.REVIEW_HIDDEN).get()
        self.client.force_authenticate(self.buyer)
        item = self.client.get(reverse("notifications")).data["results"][0]
        self.assertIn("توهین‌آمیز", item["text"])
        self.assertNotIn("مدیر سایت", item["text"])  # not who hid it
        self.assertEqual(item["link"], {"kind": "app", "path": f"/books/{book.pk}#reviews"})
        self.assertEqual(n.review, review)


# ---------------------------------------------------------------------------
# The API: reading, privacy, retention
# ---------------------------------------------------------------------------

class ApiTests(NotificationTestBase):
    def make(self, user, days_ago=0, **extra):
        n = Notification.objects.create(
            recipient=user, type=Type.TOPUP_APPROVED, params={"amount": 1000}, **extra
        )
        Notification.objects.filter(pk=n.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
        return n

    def test_list_count_read_and_read_all(self):
        older = self.make(self.buyer, days_ago=2)
        newer = self.make(self.buyer)
        self.make(self.other)
        self.client.force_authenticate(self.buyer)
        data = self.client.get(reverse("notifications")).data
        self.assertEqual([r["id"] for r in data["results"]], [newer.pk, older.pk])
        self.assertEqual(set(data["results"][0]), {"id", "type", "icon", "text", "link", "created_at", "read_at"})
        # Opening the list reads nothing
        self.assertEqual(self.client.get(reverse("notifications_unread_count")).data, {"count": 2})

        self.assertEqual(self.client.post(reverse("notification_read", args=[newer.pk])).status_code, 204)
        self.assertEqual(self.client.get(reverse("notifications_unread_count")).data, {"count": 1})
        self.assertEqual(self.client.post(reverse("notifications_read_all")).data, {"marked": 1})
        self.assertEqual(self.client.get(reverse("notifications_unread_count")).data, {"count": 0})
        self.assertIsNone(of(self.other).get().read_at)

    def test_someone_elses_notification_is_404(self):
        theirs = self.make(self.other)
        self.client.force_authenticate(self.buyer)
        self.assertEqual(self.client.post(reverse("notification_read", args=[theirs.pk])).status_code, 404)
        self.assertEqual(self.client.get(reverse("notifications")).data["count"], 0)
        self.assertIsNone(Notification.objects.get().read_at)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("notifications")).status_code, 401)

    def test_each_admin_has_their_own_read_state(self):
        book = BookFactory.make(self.uploader, price=None, book_status=Book.Status.PENDING)
        mine = of(self.admin).get()
        self.client.force_authenticate(self.admin)
        self.client.post(reverse("notification_read", args=[mine.pk]))
        self.assertIsNone(of(self.admin2).get().read_at)
        item = self.client.get(reverse("notifications")).data["results"][0]
        self.assertEqual(item["link"]["kind"], "admin")
        self.assertTrue(item["link"]["url"].endswith(f"/admin/catalog/book/{book.pk}/change/"))

    def test_older_than_90_days_is_never_returned(self):
        old = self.make(self.buyer, days_ago=RETENTION_DAYS + 1)
        self.make(self.buyer, days_ago=RETENTION_DAYS - 1)
        self.client.force_authenticate(self.buyer)
        self.assertEqual(self.client.get(reverse("notifications_unread_count")).data, {"count": 1})
        self.assertEqual(self.client.post(reverse("notification_read", args=[old.pk])).status_code, 404)
        self.assertEqual(self.client.get(reverse("notifications")).data["count"], 1)

    def test_list_deletes_only_my_old_notifications(self):
        self.make(self.buyer, days_ago=RETENTION_DAYS + 1)
        others_old = self.make(self.other, days_ago=RETENTION_DAYS + 1)
        recent = self.make(self.buyer)
        self.client.force_authenticate(self.buyer)
        self.client.get(reverse("notifications"))
        self.assertEqual(list(Notification.objects.order_by("pk")), [others_old, recent])

    def test_purge_command_deletes_everyones_old_notifications(self):
        self.make(self.buyer, days_ago=RETENTION_DAYS + 1)
        self.make(self.other, days_ago=RETENTION_DAYS + 5)
        recent = self.make(self.other)
        out = StringIO()
        call_command("purge_old_notifications", stdout=out)
        self.assertEqual(list(Notification.objects.all()), [recent])
        self.assertIn("2 notification(s)", out.getvalue())

    def test_deleted_source_keeps_the_text_but_has_no_link(self):
        book = BookFactory.make(self.uploader, price=None, book_status=Book.Status.PENDING)
        Notification.objects.all().delete()
        book.status = Book.Status.REJECTED
        book.rejection_reason = "فایل ناقص"
        book.save()
        book.delete()  # a rejected upload with no sales may be deleted by an admin
        self.client.force_authenticate(self.uploader)
        item = self.client.get(reverse("notifications")).data["results"][0]
        self.assertIsNone(item["link"])
        self.assertIn(book.title, item["text"])

    def test_notify_outside_a_transaction_is_refused(self):
        # TestCase wraps each test in a transaction; this checks the guard itself
        conn = transaction.get_connection()
        saved = conn.in_atomic_block
        conn.in_atomic_block = False
        try:
            with self.assertRaises(RuntimeError):
                services.notify(Type.TOPUP_APPROVED, [self.buyer])
        finally:
            conn.in_atomic_block = saved
