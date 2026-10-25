from book_requests.models import BookRequest
from catalog.models import APPROVED_NEEDS_PRICE, PRICE_BELOW_SELLER_SHARE, REJECTION_REASON_REQUIRED, Book, Category, Tag
from notifications.models import Notification
from support import services as support
from support.models import Message

from .helpers import AdminApiTestCase, Make


def system_texts(parent):
    conversation = support.find(parent)
    return [] if conversation is None else list(
        conversation.messages.filter(sender=Message.Sender.SYSTEM).values_list("body", flat=True)
    )


class BookQueueTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.uploader = Make.user("sara")
        self.old = Make.book(self.uploader, seller_share=1000)
        self.new = Make.book(self.uploader, seller_share=1000)
        Make.book(self.uploader, Book.Status.APPROVED, price=5000)

    def test_pending_is_oldest_first_with_counts(self):
        data = self.client.get("/admin-api/books/").data
        self.assertEqual([r["id"] for r in data["results"]], [self.old.pk, self.new.pk])
        self.assertEqual(data["pending_count"], 2)
        self.assertEqual(data["results"][0]["uploaded_by"]["full_name"], "sara تست")

    def test_other_filters_and_search(self):
        self.assertEqual(self.client.get("/admin-api/books/?status=all").data["count"], 3)
        data = self.client.get("/admin-api/books/", {"status": "all", "search": self.new.isbn}).data
        self.assertEqual([r["id"] for r in data["results"]], [self.new.pk])
        self.assertEqual(self.client.get("/admin-api/books/", {"search": "sara"}).data["count"], 2)

    def test_unread_count_is_support_side(self):
        support.post_user_message(self.uploader, self.old, "سلام")
        support.post_user_message(self.uploader, self.old, "هستید؟")
        row = self.client.get("/admin-api/books/").data["results"][0]
        self.assertEqual(row["unread_count"], 2)
        self.client.post(f"/admin-api/books/{self.old.pk}/conversation/read/")
        self.assertEqual(self.client.get("/admin-api/books/").data["results"][0]["unread_count"], 0)


class BookEditTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        self.uploader = Make.user("sara")
        self.book = Make.book(self.uploader, seller_share=80_000)
        self.url = f"/admin-api/books/{self.book.pk}/"

    def patch(self, **data):
        return self.client.patch(self.url, data, format="json")

    def test_detail_has_what_the_form_needs(self):
        data = self.client.get(self.url).data
        for key in ("seller_share", "price", "commission", "tags", "category_id", "rejection_reason", "open_request_count"):
            self.assertIn(key, data)
        self.assertEqual(data["authors"], "نویسنده")

    def test_approve_needs_price_and_price_covers_share(self):
        response = self.patch(status="approved")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["price"], [APPROVED_NEEDS_PRICE])
        response = self.patch(status="approved", price=50_000)
        self.assertEqual(response.data["price"], [PRICE_BELOW_SELLER_SHARE])
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "pending")

        response = self.patch(status="approved", price=80_000)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["commission"], 0)

    def test_admin_can_change_seller_share_but_rule_still_holds(self):
        self.assertEqual(self.patch(status="approved", price=100_000, seller_share=70_000).status_code, 200)
        self.book.refresh_from_db()
        self.assertEqual((self.book.seller_share, self.book.commission), (70_000, 30_000))
        # Raising the share above an approved book's price is refused
        response = self.patch(seller_share=120_000)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["price"], [PRICE_BELOW_SELLER_SHARE])

    def test_reject_needs_reason_which_is_stored_and_sent(self):
        response = self.patch(status="rejected", rejection_reason="  ")
        self.assertEqual(response.data["rejection_reason"], [REJECTION_REASON_REQUIRED])

        response = self.patch(status="rejected", rejection_reason="فایل ناقص است")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["rejection_reason"], "فایل ناقص است")
        self.assertEqual(system_texts(self.book), ["کتاب شما رد شد. دلیل: فایل ناقص است"])
        notification = Notification.objects.get(recipient=self.uploader, type=Notification.Type.UPLOAD_REJECTED)
        self.assertEqual(notification.params["reason"], "فایل ناقص است")

        # Leaving rejected clears it
        self.assertEqual(self.patch(status="pending").data["rejection_reason"], "")

    def test_tags_by_name_and_unknown_ones_created(self):
        Tag.objects.create(name="کلاسیک")
        response = self.patch(tags=["کلاسیک", " #برچسب   تازه ", "کلاسیک", ""])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["tags"], ["برچسب تازه", "کلاسیک"])
        self.assertEqual(Tag.objects.count(), 2)
        self.assertEqual(self.patch(tags=["x" * 51]).status_code, 400)

    def test_category_description_and_unknown_category(self):
        category = Category.objects.create(name="فلسفه")
        response = self.patch(category_id=category.pk, description="  توضیح  ")
        self.assertEqual((response.data["category_id"], response.data["description"]), (category.pk, "توضیح"))
        self.assertEqual(self.patch(category_id=999_999).status_code, 400)
        self.assertIsNone(self.patch(category_id=None).data["category_id"])

    def test_approval_fulfils_the_open_request_and_tells_every_requester(self):
        a, b = Make.user("ali"), Make.user("bita")
        book_request, entries = Make.request(a, b, isbn=self.book.isbn)
        self.assertEqual(self.client.get(self.url).data["open_request_count"], 2)

        self.assertEqual(self.patch(status="approved", price=90_000).status_code, 200)
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, BookRequest.Status.FULFILLED)
        for entry in entries:
            self.assertEqual(system_texts(entry), ["درخواست شما تأمین شد و کتاب در فروشگاه قرار گرفت."])
            self.assertEqual(support.find(entry).closed_kind, "fulfilled")
        self.assertEqual(
            Notification.objects.filter(type=Notification.Type.REQUEST_FULFILLED).count(), 2
        )
        self.assertEqual(system_texts(self.book), ["کتاب شما تأیید شد و در فروشگاه قرار گرفت."])

    def test_isbn_conflict_is_a_400_not_a_500(self):
        self.patch(status="rejected", rejection_reason="فایل ناقص")
        Make.book(self.uploader, isbn=self.book.isbn)  # a new upload of the same ISBN
        response = self.patch(status="pending")
        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.data)

    def test_missing_book(self):
        self.assertEqual(self.client.get("/admin-api/books/999999/").status_code, 404)
        self.assertEqual(self.client.patch("/admin-api/books/999999/", {}, format="json").status_code, 404)
