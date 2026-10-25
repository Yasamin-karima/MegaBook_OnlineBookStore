from datetime import timedelta

from django.contrib.admin.sites import site
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from book_requests.models import BookRequest, RequestEntry
from catalog.models import Book

from . import services
from .admin import ConversationAdmin
from .models import Conversation, ConversationAdminAction, ImmutableMessageError, Message

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"


def make_user(name, **extra):
    return User.objects.create_user(
        email=f"{name}@example.com", first_name=name, last_name="Test", password=PASSWORD, **extra
    )


def make_admin():
    return User.objects.create_superuser(email="admin@example.com", first_name="Admin", last_name="Ahmadi", password=PASSWORD)


class Fixtures:
    counter = 0

    @classmethod
    def request_for(cls, *users, isbn=None, **fields):
        cls.counter += 1
        book_request = BookRequest.objects.create(
            isbn=isbn or f"976{cls.counter:010d}", title="کتاب درخواستی", authors="نویسنده", **fields
        )
        entries = [RequestEntry.objects.create(request=book_request, requester=u) for u in users]
        return book_request, entries

    @classmethod
    def book(cls, uploader, book_status=Book.Status.PENDING, price=None):
        cls.counter += 1
        return Book.objects.create(
            title="کتاب من", isbn=f"975{cls.counter:010d}", status=book_status, price=price,
            uploaded_by=uploader, book_file="books/files/x.pdf",
        )


def system_texts(parent):
    conversation = services.find(parent)
    return [] if conversation is None else list(
        conversation.messages.filter(sender="system").values_list("body", flat=True)
    )


class ModelConstraintTests(TestCase):
    def setUp(self):
        self.user = make_user("sara")
        _, (self.entry,) = Fixtures.request_for(self.user)
        self.book = Fixtures.book(self.user)

    def test_exactly_one_parent(self):
        for parents in ({}, {"request_entry": self.entry, "book": self.book}):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Conversation.objects.create(**parents)

    def test_one_conversation_per_parent(self):
        Conversation.objects.create(book=self.book)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Conversation.objects.create(book=self.book)

    def test_messages_are_immutable(self):
        message = services.post_user_message(self.user, self.book, "سلام")
        message.body = "ویرایش"
        with self.assertRaises(ImmutableMessageError):
            message.save()
        with self.assertRaises(ImmutableMessageError):
            message.delete()
        with self.assertRaises(ImmutableMessageError):
            Message.objects.update(body="x")
        with self.assertRaises(ImmutableMessageError):
            Message.objects.all().delete()

    def test_no_empty_conversations(self):
        # Requesting, uploading and opening the page create nothing
        self.assertEqual(Conversation.objects.count(), 0)
        self.client.force_login(self.user)
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(self.user)
        client.get(f"/support/requests/{self.entry.pk}/")
        client.post(f"/support/uploads/{self.book.pk}/read/")
        self.assertEqual(Conversation.objects.count(), 0)
        services.post_user_message(self.user, self.entry, "اولین پیام")
        self.assertEqual(Conversation.objects.count(), 1)


class OwnershipAndApiTests(APITestCase):
    def setUp(self):
        cache.clear()  # throttle counters
        self.a = make_user("ali")
        self.b = make_user("bita")
        _, (self.entry_b,) = Fixtures.request_for(self.b)
        self.book_b = Fixtures.book(self.b)

    def test_cannot_read_or_post_to_someone_elses(self):
        services.post_user_message(self.b, self.entry_b, "پیام خصوصی")
        self.client.force_authenticate(self.a)
        for base in (f"/support/requests/{self.entry_b.pk}", f"/support/uploads/{self.book_b.pk}"):
            self.assertEqual(self.client.get(f"{base}/").status_code, status.HTTP_404_NOT_FOUND)
            self.assertEqual(self.client.post(f"{base}/messages/", {"text": "x"}).status_code, status.HTTP_404_NOT_FOUND)
            self.assertEqual(self.client.post(f"{base}/read/").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(Message.objects.filter(author=self.a).count(), 0)

    def test_requires_login(self):
        self.assertEqual(self.client.get(f"/support/requests/{self.entry_b.pk}/").status_code, 401)
        self.assertEqual(self.client.get("/support/unread/").status_code, 401)

    def test_same_isbn_separate_conversations(self):
        book_request, (entry_a,) = Fixtures.request_for(self.a)
        entry_b = RequestEntry.objects.create(request=book_request, requester=self.b)
        services.post_user_message(self.a, entry_a, "پیام علی")
        services.post_user_message(self.b, entry_b, "پیام بیتا")
        self.client.force_authenticate(self.a)
        texts = [m["text"] for m in self.client.get(f"/support/requests/{entry_a.pk}/").data["messages"]]
        self.assertEqual(texts, ["پیام علی"])
        self.assertNotEqual(services.find(entry_a), services.find(entry_b))

    def test_frontend_cannot_forge_support_or_system(self):
        self.client.force_authenticate(self.b)
        response = self.client.post(
            f"/support/uploads/{self.book_b.pk}/messages/",
            {"text": "سلام", "sender": "support", "kind": "system", "author": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["sender"], "me")
        message = Message.objects.get()
        self.assertEqual((message.sender, message.author), ("user", self.b))

    def test_support_shown_without_admin_name(self):
        admin = make_admin()
        services.post_support_message(admin, self.book_b, "پاسخ پشتیبانی")
        self.client.force_authenticate(self.b)
        response = self.client.get(f"/support/uploads/{self.book_b.pk}/")
        self.assertEqual(response.data["messages"][0]["sender"], "support")
        body = response.content.decode()
        self.assertNotIn("Ahmadi", body)
        self.assertNotIn("admin@example.com", body)
        self.assertNotIn('"author"', body)

    def test_html_is_stored_and_returned_as_plain_text(self):
        self.client.force_authenticate(self.b)
        payload = '<script>alert("x")</script><b>bold</b>'
        self.client.post(f"/support/uploads/{self.book_b.pk}/messages/", {"text": payload})
        data = self.client.get(f"/support/uploads/{self.book_b.pk}/").data
        # The API returns the exact text (a JSON string); React shows it as text, escaped
        self.assertEqual(data["messages"][0]["text"], payload)

    def test_message_length_and_empty(self):
        self.client.force_authenticate(self.b)
        url = f"/support/uploads/{self.book_b.pk}/messages/"
        self.assertEqual(self.client.post(url, {"text": "   "}).status_code, 400)
        self.assertEqual(self.client.post(url, {"text": "x" * 2001}).status_code, 400)
        self.assertEqual(self.client.post(url, {"text": "x" * 2000}).status_code, 201)

    def test_polling_after(self):
        self.client.force_authenticate(self.b)
        url = f"/support/uploads/{self.book_b.pk}/"
        first = self.client.post(f"{url}messages/", {"text": "یک"}).data["id"]
        self.client.post(f"{url}messages/", {"text": "دو"})
        newer = self.client.get(url, {"after": first}).data["messages"]
        self.assertEqual([m["text"] for m in newer], ["دو"])

    def test_upload_item_shows_own_money_fields(self):
        self.client.force_authenticate(self.b)
        item = self.client.get(f"/support/uploads/{self.book_b.pk}/").data["item"]
        self.assertEqual(
            set(item),
            {"id", "isbn", "title", "authors", "cover", "status", "price", "seller_share",
             "sales_count", "earnings", "created_at"},
        )
        self.assertNotIn("book_file", str(item))

    def test_throttling(self):
        self.client.force_authenticate(self.b)
        url = f"/support/uploads/{self.book_b.pk}/messages/"
        codes = [self.client.post(url, {"text": f"پیام {i}"}).status_code for i in range(11)]
        self.assertEqual(codes[:10], [201] * 10)
        self.assertEqual(codes[10], status.HTTP_429_TOO_MANY_REQUESTS)


class StatusChangeTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.a, self.b = make_user("ali"), make_user("bita")
        self.book_request, (self.entry_a, self.entry_b) = Fixtures.request_for(self.a, self.b)

    def set_status(self, new_status, reason=""):
        self.book_request.status = new_status
        self.book_request.rejection_reason = reason
        self.book_request.save()

    def test_rejection_message_to_every_requester_and_reason_cleared_later(self):
        self.set_status(BookRequest.Status.REJECTED, "حق نشر ندارد")
        for entry in (self.entry_a, self.entry_b):
            self.assertEqual(system_texts(entry), ["درخواست شما رد شد. دلیل: حق نشر ندارد"])
            self.assertFalse(services.find(entry).is_closed)  # rejected stays open

        self.set_status(BookRequest.Status.OPEN)
        self.book_request.refresh_from_db()
        self.assertEqual(self.book_request.rejection_reason, "")
        texts = system_texts(self.entry_a)
        self.assertEqual(texts[0], "درخواست شما رد شد. دلیل: حق نشر ندارد")
        self.assertEqual(len(texts), 2)

    def test_fulfilled_closes_and_unfulfilling_reopens_only_automatic(self):
        services.post_user_message(self.b, self.entry_b, "سلام")
        services.close(services.find(self.entry_b), self.admin, "بی‌ادبی")

        self.set_status(BookRequest.Status.FULFILLED)
        conv_a, conv_b = services.find(self.entry_a), services.find(self.entry_b)
        self.assertEqual(conv_a.closed_kind, "fulfilled")
        self.assertEqual(conv_b.closed_kind, "support")  # stays a manual close

        self.set_status(BookRequest.Status.OPEN)
        conv_a.refresh_from_db()
        conv_b.refresh_from_db()
        self.assertFalse(conv_a.is_closed)
        self.assertEqual(conv_b.closed_kind, "support")

    def test_saving_without_status_change_writes_nothing(self):
        self.book_request.title = "عنوان تازه"
        self.book_request.save()
        self.assertEqual(Message.objects.count(), 0)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_upload_approved_and_rejected(self):
        book = Fixtures.book(self.a)
        book.status, book.price = Book.Status.APPROVED, 10_000
        book.save()
        self.assertEqual(system_texts(book), ["کتاب شما تأیید شد و در فروشگاه قرار گرفت."])
        book.status, book.rejection_reason = Book.Status.REJECTED, "فایل ناقص است"
        book.save()
        # The admin's reason goes to the uploader as is
        self.assertEqual(system_texts(book)[-1], "کتاب شما رد شد. دلیل: فایل ناقص است")
        book.status = Book.Status.PENDING
        book.save()
        self.assertEqual(len(system_texts(book)), 2)  # back to pending writes nothing

    def test_new_approved_book_writes_nothing(self):
        Fixtures.book(self.admin, book_status=Book.Status.APPROVED, price=0)
        self.assertEqual(Conversation.objects.count(), 0)


class ClosingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.user = make_user("sara")
        _, (self.entry,) = Fixtures.request_for(self.user)
        services.post_user_message(self.user, self.entry, "سلام")
        self.conversation = services.find(self.entry)
        self.url = f"/support/requests/{self.entry.pk}/"
        self.client.force_authenticate(self.user)

    def test_closed_is_readable_but_not_writable_and_reason_hidden(self):
        services.close(self.conversation, self.admin, "توهین به پشتیبانی")
        response = self.client.post(f"{self.url}messages/", {"text": "باز هم"})
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        data = self.client.get(self.url).data
        self.assertEqual(data["conversation"]["state"], "closed")
        self.assertEqual(data["conversation"]["closed_kind"], "support")
        self.assertEqual(data["messages"][-1]["text"], "این گفت‌وگو توسط پشتیبانی بسته شد.")
        self.assertNotIn("توهین", str(data))
        # Support can still write into a closed conversation
        services.post_support_message(self.admin, self.conversation, "پاسخ آخر")

        services.reopen(self.conversation, self.admin)
        self.assertEqual(self.client.post(f"{self.url}messages/", {"text": "ممنون"}).status_code, 201)
        self.assertIn("گفت‌وگو دوباره باز شد.", [m["text"] for m in self.client.get(self.url).data["messages"]])

    def test_close_and_reopen_are_recorded_with_admin_and_time(self):
        services.close(self.conversation, self.admin, "مزاحمت")
        services.reopen(self.conversation, self.admin)
        services.close(self.conversation, self.admin, "دوباره مزاحمت")
        actions = list(
            ConversationAdminAction.objects.filter(conversation=self.conversation)
            .order_by("created_at", "id").values_list("action", "admin", "reason")
        )
        # Every cycle is kept, even though the conversation's own closed_* fields
        # only describe the current close
        self.assertEqual(actions, [
            ("close", self.admin.pk, "مزاحمت"),
            ("reopen", self.admin.pk, ""),
            ("close", self.admin.pk, "دوباره مزاحمت"),
        ])
        self.assertTrue(all(a.created_at for a in ConversationAdminAction.objects.all()))

    def test_close_needs_admin_and_reason(self):
        with self.assertRaises(services.SupportError):
            services.close(self.conversation, self.user, "x")
        with self.assertRaises(services.SupportError):
            services.close(self.conversation, self.admin, "  ")

    def test_closing_does_not_change_the_request(self):
        services.close(self.conversation, self.admin, "x")
        self.entry.request.refresh_from_db()
        self.assertEqual(self.entry.request.status, "open")


class UnreadTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_admin()
        self.user = make_user("sara")
        _, (self.entry,) = Fixtures.request_for(self.user)
        self.book = Fixtures.book(self.user)
        self.client.force_authenticate(self.user)

    def support_unread(self, parent):
        return Conversation.objects.annotate(n=services.support_unread_count()).get(pk=services.find(parent).pk).n

    def test_both_sides_before_and_after_reading(self):
        services.post_user_message(self.user, self.entry, "سؤال")
        services.post_user_message(self.user, self.entry, "سؤال دوم")
        self.assertEqual(self.support_unread(self.entry), 2)
        self.assertEqual(self.client.get("/support/unread/").data, {"requests": {}, "uploads": {}})

        services.post_support_message(self.admin, self.entry, "پاسخ")  # replying = support read
        self.assertEqual(self.support_unread(self.entry), 0)
        self.book.status, self.book.price = Book.Status.APPROVED, 0
        self.book.save()  # a system message counts for the user too
        self.assertEqual(
            self.client.get("/support/unread/").data,
            {"requests": {self.entry.pk: 1}, "uploads": {self.book.pk: 1}},
        )

        self.client.post(f"/support/requests/{self.entry.pk}/read/")
        self.assertEqual(self.client.get("/support/unread/").data["requests"], {})

    def test_admin_opening_counts_as_support_read(self):
        services.post_user_message(self.user, self.entry, "سؤال")
        self.client.force_login(self.admin)
        conversation = services.find(self.entry)
        response = self.client.get(f"/admin/support/conversation/{conversation.pk}/change/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.support_unread(self.entry), 0)

    def test_unread_list_is_two_queries(self):
        for _ in range(5):
            _, (entry,) = Fixtures.request_for(self.user)
            services.post_support_message(self.admin, entry, "پیام")
        with self.assertNumQueries(2):
            services.unread_for_user(self.user)

    def test_timestamps_decide(self):
        services.post_support_message(self.admin, self.entry, "قدیمی")
        conversation = services.find(self.entry)
        Conversation.objects.filter(pk=conversation.pk).update(user_last_read_at=timezone.now() + timedelta(seconds=1))
        self.assertEqual(services.unread_for_user(self.user)["requests"], {})


def inline_management(count=0, actions=0):
    """The hidden fields the admin page always sends for its two inlines (the messages,
    and the close/reopen history)."""
    return {
        "messages-TOTAL_FORMS": str(count), "messages-INITIAL_FORMS": str(count),
        "messages-MIN_NUM_FORMS": "0", "messages-MAX_NUM_FORMS": "1000",
        "admin_actions-TOTAL_FORMS": str(actions), "admin_actions-INITIAL_FORMS": str(actions),
        "admin_actions-MIN_NUM_FORMS": "0", "admin_actions-MAX_NUM_FORMS": "1000",
    }


class AdminTests(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.user = make_user("sara")
        _, (self.entry,) = Fixtures.request_for(self.user)
        self.client.force_login(self.admin)

    def test_admin_starts_with_first_message_and_replies_as_support(self):
        response = self.client.post("/admin/support/conversation/add/", {
            "request_entry": self.entry.pk, "book": "", "reply": "سلام از پشتیبانی", **inline_management(),
        })
        self.assertEqual(response.status_code, 302, getattr(response, "context", None) and response.context["adminform"].form.errors)
        conversation = services.find(self.entry)
        message = conversation.messages.get()
        self.assertEqual((message.sender, message.author), ("support", self.admin))

    def test_admin_add_without_message_creates_nothing(self):
        self.client.post("/admin/support/conversation/add/", {"request_entry": self.entry.pk, "book": "", "reply": "", **inline_management()})
        self.assertEqual(Conversation.objects.count(), 0)

    def test_admin_close_and_reopen(self):
        services.post_user_message(self.user, self.entry, "سلام")
        conversation = services.find(self.entry)
        url = f"/admin/support/conversation/{conversation.pk}/change/"
        self.client.post(url, {"reply": "", "close": "on", "close_reason": "اسپم", **inline_management(1)})
        conversation.refresh_from_db()
        self.assertEqual((conversation.closed_kind, conversation.closed_by), ("support", self.admin))
        self.client.post(url, {"reply": "", "reopen": "on", **inline_management(2, actions=1)})
        conversation.refresh_from_db()
        self.assertFalse(conversation.is_closed)

    def test_list_filters_and_unread_column(self):
        services.post_user_message(self.user, self.entry, "سلام")
        for query in ("", "?state=open", "?state=closed", "?kind=request", "?kind=upload"):
            self.assertEqual(self.client.get(f"/admin/support/conversation/{query}").status_code, 200)
        model_admin = ConversationAdmin(Conversation, site)
        self.assertFalse(model_admin.has_delete_permission(None))

    def test_rejection_reason_help_text(self):
        field = BookRequest._meta.get_field("rejection_reason")
        self.assertEqual(field.help_text, "این متن عیناً برای کاربر ارسال می‌شود")
