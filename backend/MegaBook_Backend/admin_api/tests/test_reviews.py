from catalog.models import Book
from notifications.models import Notification
from reviews.models import HIDE_REASON_REQUIRED, Review

from .helpers import AdminApiTestCase, Make


class ReviewModerationTests(AdminApiTestCase):
    def setUp(self):
        super().setUp()
        uploader = Make.user("u")
        self.book = Make.book(uploader, Book.Status.APPROVED, price=0)
        self.sara, self.ali, self.bita = Make.user("sara"), Make.user("ali"), Make.user("bita")
        self.old = Make.review(self.sara, self.book, "خوب بود")
        self.new = Make.review(self.ali, self.book, "عالی بود")
        Make.review(self.bita, self.book, "")  # rating only: nothing to moderate

    def ids(self, url="/admin-api/reviews/"):
        return [r["id"] for r in self.client.get(url).data["results"]]

    def test_only_text_newest_submission_first(self):
        data = self.client.get("/admin-api/reviews/?filter=all").data
        self.assertEqual([r["id"] for r in data["results"]], [self.new.pk, self.old.pk])
        self.assertEqual(data["new_count"], 2)
        self.assertEqual(data["results"][0]["author"]["display_name"], "ali ت.")
        # An author's edit brings a review back to the top, and "new" again
        self.old.author_submit(5, "ویرایش شد")
        self.assertEqual(self.ids("/admin-api/reviews/?filter=all"), [self.old.pk, self.new.pk])

    def test_check_moves_it_out_of_new(self):
        response = self.client.post(f"/admin-api/reviews/{self.new.pk}/check/")
        self.assertEqual((response.status_code, response.data["is_checked"]), (200, True))
        self.assertEqual(self.ids(), [self.old.pk])
        self.assertEqual(self.ids("/admin-api/reviews/?filter=checked"), [self.new.pk])
        # The author's next edit makes it "new" again
        self.new.author_submit(3, "دوباره")
        self.assertEqual(self.ids(), [self.new.pk, self.old.pk])

    def test_hide_needs_reason_the_author_sees(self):
        response = self.client.post(f"/admin-api/reviews/{self.new.pk}/hide/", {"reason": " "})
        self.assertEqual((response.status_code, response.data["reason"]), (400, [HIDE_REASON_REQUIRED]))
        response = self.client.post(f"/admin-api/reviews/{self.new.pk}/hide/", {"reason": "تبلیغ"})
        self.assertEqual((response.data["is_hidden"], response.data["hide_reason"]), (True, "تبلیغ"))
        self.assertEqual(self.client.post(f"/admin-api/reviews/{self.new.pk}/hide/", {"reason": "x"}).status_code, 409)
        notification = Notification.objects.get(recipient=self.ali, type=Notification.Type.REVIEW_HIDDEN)
        self.assertEqual(notification.params["reason"], "تبلیغ")
        self.client.force_authenticate(self.ali)
        mine = self.client.get(f"/catalog/books/{self.book.pk}/reviews/").data["my_review"]
        self.assertEqual(mine["hide_reason"], "تبلیغ")

    def test_unhide(self):
        self.client.post(f"/admin-api/reviews/{self.new.pk}/hide/", {"reason": "تبلیغ"})
        response = self.client.post(f"/admin-api/reviews/{self.new.pk}/unhide/")
        self.assertEqual((response.data["is_hidden"], response.data["hide_reason"], response.data["previously_hidden"]), (False, "", True))
        self.assertEqual(self.client.post(f"/admin-api/reviews/{self.new.pk}/unhide/").status_code, 409)

    def test_rating_only_review_is_not_reachable(self):
        rating_only = Review.objects.get(body="")
        self.assertEqual(self.client.post(f"/admin-api/reviews/{rating_only.pk}/check/").status_code, 404)
