from book_requests.models import REJECTION_REASON_REQUIRED, BookRequest
from catalog.models import Book
from notifications.models import Notification
from support import services as support

from .helpers import AdminApiTestCase, Make
from .test_books import system_texts


class RequestQueueTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.a, self.b, self.c = Make.user("ali"), Make.user("bita"), Make.user("cyrus")
        self.popular, _ = Make.request(self.a, self.b, self.c)
        self.single, _ = Make.request(self.a)

    def test_new_filter_most_requesters_first(self):
        data = self.client.get("/admin-api/book-requests/").data
        self.assertEqual([r["id"] for r in data["results"]], [self.popular.pk, self.single.pk])
        self.assertEqual(data["results"][0]["requester_count"], 3)
        self.assertEqual(data["new_count"], 2)

    def test_mark_reviewed_takes_it_out_of_new_but_keeps_it_open(self):
        response = self.client.post(f"/admin-api/book-requests/{self.popular.pk}/mark-reviewed/")
        self.assertEqual(response.status_code, 204)
        data = self.client.get("/admin-api/book-requests/").data
        self.assertEqual([r["id"] for r in data["results"]], [self.single.pk])
        self.popular.refresh_from_db()
        self.assertEqual(self.popular.status, "open")
        self.assertIsNotNone(self.popular.reviewed_at)
        self.assertEqual(self.client.get("/admin-api/book-requests/?filter=open").data["count"], 2)

    def test_unread_sums_every_requesters_conversation(self):
        entries = self.popular.entries.order_by("pk")
        support.post_user_message(self.a, entries[0], "سلام")
        support.post_user_message(self.b, entries[1], "سلام")
        row = self.client.get("/admin-api/book-requests/").data["results"][0]
        self.assertEqual(row["unread_count"], 2)
        detail = self.client.get(f"/admin-api/book-requests/{self.popular.pk}/").data
        self.assertEqual([e["unread_count"] for e in detail["entries"]], [1, 1, 0])


class RequestStatusTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.a, self.b = Make.user("ali"), Make.user("bita")
        self.book_request, self.entries = Make.request(self.a, self.b)
        self.url = f"/admin-api/book-requests/{self.book_request.pk}/"

    def patch(self, new_status, reason=""):
        return self.client.patch(self.url, {"status": new_status, "rejection_reason": reason}, format="json")

    def test_reject_needs_reason_and_every_change_messages_every_requester(self):
        response = self.patch("rejected")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["rejection_reason"], [REJECTION_REASON_REQUIRED])

        response = self.patch("rejected", "حق نشر ندارد")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["reviewed_at"])
        for entry in self.entries:
            self.assertEqual(system_texts(entry), ["درخواست شما رد شد. دلیل: حق نشر ندارد"])
            self.assertFalse(support.find(entry).is_closed)  # rejected stays open
        self.assertEqual(Notification.objects.filter(type=Notification.Type.REQUEST_REJECTED).count(), 2)

        # Any direction; leaving rejected clears the reason
        response = self.patch("open")
        self.assertEqual(response.data["rejection_reason"], "")
        self.assertEqual(len(system_texts(self.entries[0])), 2)

    def test_fulfilled_closes_the_conversations_for_the_user_only(self):
        self.assertEqual(self.patch("fulfilled").status_code, 200)
        for entry in self.entries:
            self.assertEqual(support.find(entry).closed_kind, "fulfilled")
        detail = self.client.get(self.url).data
        self.assertEqual(detail["entries"][0]["conversation"]["state"], "closed")
        # The user can't write; support still can
        self.client.force_authenticate(self.a)
        self.assertEqual(
            self.client.post(f"/support/requests/{self.entries[0].pk}/messages/", {"text": "سلام"}).status_code, 409
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/admin-api/request-entries/{self.entries[0].pk}/conversation/messages/", {"text": "کتاب در فروشگاه است"}
        )
        self.assertEqual(response.status_code, 201)

        # Back to open reopens the automatically closed conversations
        self.patch("open")
        self.assertFalse(support.find(self.entries[0]).is_closed)

    def test_book_in_store_and_in_review(self):
        uploader = Make.user("u")
        pending = Make.book(uploader, isbn=self.book_request.isbn)
        detail = self.client.get(self.url).data
        self.assertEqual((detail["book_in_store"], detail["book_in_review"]), (None, {"id": pending.pk}))
        pending.status, pending.price = Book.Status.APPROVED, 0
        pending.save()
        detail = self.client.get(self.url).data
        self.assertEqual(detail["book_in_store"], {"id": pending.pk})
        self.assertEqual(detail["status"], BookRequest.Status.FULFILLED)
