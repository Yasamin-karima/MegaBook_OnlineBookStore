from django.core.cache import cache

from notifications.models import Notification
from support import services as support
from support.models import Conversation, ConversationAdminAction

from .helpers import AdminApiTestCase, Make


class ParentConversationTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.uploader = Make.user("sara")
        self.book = Make.book(self.uploader)
        self.base = f"/admin-api/books/{self.book.pk}/conversation/"

    def test_no_conversation_yet_creates_nothing(self):
        data = self.client.get(self.base).data
        self.assertEqual((data["conversation"]["state"], data["messages"]), ("open", []))
        self.assertEqual(Conversation.objects.count(), 0)

    def test_support_message_shows_admin_name_to_admins_only(self):
        response = self.client.post(f"{self.base}messages/", {"text": "سلام، سهم را بررسی کردیم."})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sender"], "support")
        self.assertEqual(response.data["author"], "admin مدیر")
        self.assertEqual(self.client.get(self.base).data["messages"][0]["author"], "admin مدیر")
        # One notification per conversation, not per message (while it's unread)
        self.client.post(f"{self.base}messages/", {"text": "پیام دوم"})
        self.assertEqual(
            Notification.objects.filter(recipient=self.uploader, type=Notification.Type.SUPPORT_REPLY).count(), 1
        )
        # The user sees only «پشتیبانی مگابوک», never the admin's name
        self.client.force_authenticate(self.uploader)
        user_view = self.client.get(f"/support/uploads/{self.book.pk}/").data
        self.assertEqual({m["sender"] for m in user_view["messages"]}, {"support"})
        self.assertNotIn("مدیر", str(user_view["messages"]))

    def test_empty_message_is_400(self):
        self.assertEqual(self.client.post(f"{self.base}messages/", {"text": "  "}).status_code, 400)

    def test_polling_returns_only_newer_messages(self):
        first = self.client.post(f"{self.base}messages/", {"text": "یک"}).data
        self.client.post(f"{self.base}messages/", {"text": "دو"})
        data = self.client.get(self.base, {"after": first["id"]}).data
        self.assertEqual([m["text"] for m in data["messages"]], ["دو"])

    def test_opening_marks_this_admins_notification_read(self):
        other_admin = Make.admin("other")
        support.post_user_message(self.uploader, self.book, "سلام")
        self.client.get(self.base)
        unread = Notification.objects.filter(type=Notification.Type.STAFF_USER_MESSAGE, read_at__isnull=True)
        self.assertEqual(list(unread.values_list("recipient", flat=True)), [other_admin.pk])

    def test_close_and_reopen_record_admin_time_and_post_system_messages(self):
        support.post_user_message(self.uploader, self.book, "سلام")
        self.assertEqual(self.client.post(f"{self.base}close/", {"reason": " "}).status_code, 400)

        response = self.client.post(f"{self.base}close/", {"reason": "پیام‌های توهین‌آمیز"})
        self.assertEqual(response.status_code, 200)
        state = response.data["conversation"]
        self.assertEqual((state["state"], state["closed_kind"], state["closed_by"]), ("closed", "support", "admin مدیر"))
        self.assertEqual(state["close_reason"], "پیام‌های توهین‌آمیز")
        self.assertEqual(self.client.post(f"{self.base}close/", {"reason": "باز"}).status_code, 409)

        self.assertEqual(self.client.post(f"{self.base}reopen/").status_code, 200)
        self.assertEqual(self.client.post(f"{self.base}reopen/").status_code, 409)

        data = self.client.get(self.base).data
        texts = [m["text"] for m in data["messages"] if m["sender"] == "system"]
        self.assertEqual(texts, ["این گفت‌وگو توسط پشتیبانی بسته شد.", "گفت‌وگو دوباره باز شد."])
        self.assertEqual([h["action"] for h in data["history"]], ["reopen", "close"])
        self.assertTrue(all(h["admin"] == "admin مدیر" and h["created_at"] for h in data["history"]))
        self.assertEqual(ConversationAdminAction.objects.count(), 2)

        # The user never sees the reason
        self.client.force_authenticate(self.uploader)
        self.assertNotIn("توهین", str(self.client.get(f"/support/uploads/{self.book.pk}/").data))

    def test_closing_without_a_conversation_is_409(self):
        self.assertEqual(self.client.post(f"{self.base}close/", {"reason": "x"}).status_code, 409)

    def test_entry_conversation_404_for_missing_entry(self):
        self.assertEqual(self.client.get("/admin-api/request-entries/99999/conversation/").status_code, 404)


class InboxTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.sara, self.ali = Make.user("sara"), Make.user("ali")
        self.book = Make.book(self.sara)
        _, (self.entry,) = Make.request(self.ali)
        support.post_user_message(self.ali, self.entry, "اول")       # older, waiting
        support.post_user_message(self.sara, self.book, "دوم")       # newer, waiting
        self.answered = Make.book(self.sara)
        support.post_user_message(self.sara, self.answered, "سوم")
        support.post_support_message(self.admin, self.answered, "جواب")  # last from us: not waiting

    def test_waiting_is_open_with_last_message_from_user_oldest_first(self):
        data = self.client.get("/admin-api/conversations/").data
        self.assertEqual([(r["kind"], r["parent_id"]) for r in data["results"]], [("entry", self.entry.pk), ("upload", self.book.pk)])
        self.assertEqual(data["waiting_count"], 2)
        self.assertEqual(data["results"][0]["last_message"]["text"], "اول")
        self.assertEqual(data["results"][0]["unread_count"], 1)

    def test_closed_conversation_is_not_waiting(self):
        support.close(support.find(self.book), self.admin, "x")
        data = self.client.get("/admin-api/conversations/").data
        self.assertEqual(data["waiting_count"], 1)
        closed = self.client.get("/admin-api/conversations/?filter=closed").data["results"]
        self.assertEqual([r["parent_id"] for r in closed], [self.book.pk])

    def test_kind_search_and_single_item(self):
        self.assertEqual(self.client.get("/admin-api/conversations/?filter=all&kind=upload").data["count"], 2)
        self.assertEqual(self.client.get("/admin-api/conversations/", {"filter": "all", "search": "ali"}).data["count"], 1)
        conversation = support.find(self.answered)
        item = self.client.get(f"/admin-api/conversations/{conversation.pk}/").data
        self.assertEqual((item["kind"], item["parent_id"], item["state"]), ("upload", self.answered.pk, "open"))
