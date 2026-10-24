import json
from datetime import timedelta

from django.contrib.admin import helpers
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from cart import services as cart_services
from catalog.models import Book, Person
from library.models import LibraryItem
from orders import services as order_services
from orders.models import Order, OrderItem

from .eligibility import BOOK_NOT_APPROVED, NOT_BUYER, OWN_UPLOAD, review_block_reason
from .models import HIDE_REASON_REQUIRED, RATING_RANGE, Review, ReviewHide
from .serializers import author_name

User = get_user_model()
PASSWORD = "Str0ng-Passw0rd!"

# Every key that only admins may see; none may appear in any API response
MODERATION_KEYS = {"checked_by", "checked_at", "is_checked", "hidden_by", "hidden_at", "hides", "submitted_at"}


def make_user(email, first="سارا", last="جعفری", **extra):
    return User.objects.create_user(email=email, first_name=first, last_name=last, password=PASSWORD, **extra)


def make_admin(email="admin@example.com"):
    return User.objects.create_superuser(email=email, first_name="مدیر", last_name="اصلی", password=PASSWORD)


class BookFactory:
    counter = 0

    @classmethod
    def make(cls, uploader, price=50_000, book_status=Book.Status.APPROVED, author=None):
        cls.counter += 1
        book = Book.objects.create(
            title=f"کتاب {cls.counter}", isbn=f"979{cls.counter:010d}", status=book_status,
            price=price, seller_share=0, uploaded_by=uploader, book_file="books/files/x.pdf",
        )
        if author:
            book.authors.add(Person.objects.get_or_create(name=author)[0])
        return book


def buy(user, book):
    """A purchase as checkout records it (order, order item, library item), without the money."""
    order = Order.objects.create(buyer=user)
    item = OrderItem.objects.create(order=order, book=book, price=book.price, seller_share=book.seller_share)
    LibraryItem.objects.create(user=user, book=book, order_item=item)


def reviews_url(book):
    return reverse("book_reviews", kwargs={"book_id": book.pk})


def mine_url(book):
    return reverse("my_review", kwargs={"book_id": book.pk})


def all_keys(data):
    """Every dict key anywhere in a JSON response."""
    if isinstance(data, dict):
        return set(data) | set().union(*(all_keys(v) for v in data.values()))
    if isinstance(data, list):
        return set().union(*(all_keys(v) for v in data)) if data else set()
    return set()


class ReviewTestBase(APITestCase):
    def setUp(self):
        self.admin = make_admin()
        self.seller = make_user("seller@example.com")
        self.buyer = make_user("buyer@example.com", first="سارا", last="جعفری")
        self.other = make_user("other@example.com", first="علی", last="رضایی")
        self.book = BookFactory.make(self.seller)
        buy(self.buyer, self.book)

    def post_review(self, user, book=None, **data):
        self.client.force_authenticate(user)
        return self.client.post(reviews_url(book or self.book), {"rating": 4, **data}, format="json")

    def list_reviews(self, user=None, book=None):
        self.client.force_authenticate(user)
        return self.client.get(reviews_url(book or self.book))

    def detail(self, user=None, book=None):
        self.client.force_authenticate(user)
        return self.client.get(reverse("book_detail", args=[(book or self.book).pk]))


# ---------------------------------------------------------------------------
# Who can review
# ---------------------------------------------------------------------------

class EligibilityTests(ReviewTestBase):
    def test_buyer_can_review(self):
        res = self.post_review(self.buyer, body="کتاب خوبی بود")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["rating"], 4)
        self.assertEqual(res.data["author_name"], "سارا ج.")
        self.assertFalse(res.data["is_hidden"])

    def test_buyer_of_a_free_book_through_checkout_can_review(self):
        free = BookFactory.make(self.seller, price=0)
        cart_services.add(self.other, free.pk)
        order_services.checkout(self.other)
        self.assertEqual(self.post_review(self.other, free).status_code, status.HTTP_201_CREATED)

    def test_non_buyer_cannot_review(self):
        res = self.post_review(self.other)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data["code"], NOT_BUYER)
        self.assertFalse(Review.objects.exists())

    def test_uploader_cannot_review_own_book(self):
        res = self.post_review(self.seller)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data["code"], OWN_UPLOAD)

    def test_book_in_library_without_a_purchase_does_not_count(self):
        # Bookmarks have no backend yet; the nearest "has it but didn't buy it" is a
        # library item that no order created (e.g. a future gift)
        book = BookFactory.make(self.seller)
        LibraryItem.objects.create(user=self.other, book=book)
        res = self.post_review(self.other, book)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data["code"], NOT_BUYER)

    def test_unapproved_book(self):
        self.book.status = Book.Status.REJECTED
        self.book.save()
        # The buyer is told why; anyone else gets 404, as for the book page
        res = self.post_review(self.buyer)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data["code"], BOOK_NOT_APPROVED)
        self.assertEqual(self.post_review(self.other).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.list_reviews().status_code, status.HTTP_404_NOT_FOUND)

    def test_guest_cannot_post(self):
        self.client.force_authenticate(None)
        res = self.client.post(reviews_url(self.book), {"rating": 4}, format="json")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_detail_flags_follow_the_same_rule(self):
        cases = [(None, False), (self.other, False), (self.seller, False), (self.buyer, True)]
        for user, expected in cases:
            res = self.detail(user)
            self.assertEqual(res.data["can_review"], expected, user)
            self.assertFalse(res.data["has_review"])
            if user is not None:
                self.assertEqual(review_block_reason(user, self.book) is None, expected)
        self.post_review(self.buyer)
        res = self.detail(self.buyer)
        self.assertTrue(res.data["can_review"])
        self.assertTrue(res.data["has_review"])

    def test_one_review_per_user_per_book(self):
        self.assertEqual(self.post_review(self.buyer).status_code, status.HTTP_201_CREATED)
        res = self.post_review(self.buyer, rating=2)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["code"], "already_reviewed")
        # The database constraint, for anything that skips the API check
        with self.assertRaises(IntegrityError), transaction.atomic():
            Review.objects.create(user=self.buyer, book=self.book, rating=3)

    def test_rating_bounds(self):
        for bad in (0, 6, "abc", None):
            res = self.post_review(self.buyer, rating=bad)
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST, bad)
            self.assertIn("rating", res.data)
        self.assertEqual(self.post_review(self.buyer, rating=5).status_code, status.HTTP_201_CREATED)
        # The model rule and the database constraint
        review = Review.objects.get()
        review.rating = 6
        with self.assertRaises(ValidationError):
            review.save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Review.objects.filter(pk=review.pk).update(rating=0)

    def test_rating_required_and_persian_errors(self):
        self.client.force_authenticate(self.buyer)
        res = self.client.post(reviews_url(self.book), {"body": "متن"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["rating"], ["امتیاز را انتخاب کنید."])
        res = self.post_review(self.buyer, rating=9)
        self.assertEqual(res.data["rating"], [RATING_RANGE])

    def test_body_is_optional_trimmed_and_limited(self):
        res = self.post_review(self.buyer, body="   ")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["body"], "")
        Review.objects.all().delete()
        res = self.post_review(self.buyer, body="ب" * 2001)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("body", res.data)

    def test_edit_and_delete_own_review(self):
        self.post_review(self.buyer, body="اول")
        self.client.force_authenticate(self.buyer)
        res = self.client.patch(mine_url(self.book), {"rating": 2, "body": "دوم"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertEqual((res.data["rating"], res.data["body"]), (2, "دوم"))
        self.assertTrue(res.data["is_edited"])
        self.assertEqual(self.client.delete(mine_url(self.book)).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Review.objects.exists())
        # Nothing left to edit or delete
        self.assertEqual(self.client.delete(mine_url(self.book)).status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_touch_someone_elses_review(self):
        self.post_review(self.buyer, body="مال من")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.patch(mine_url(self.book), {"rating": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(mine_url(self.book)).status_code, 404)
        self.assertEqual(Review.objects.get().rating, 4)

    def test_author_name_is_first_name_and_initial(self):
        self.assertEqual(author_name(self.other), "علی ر.")


# ---------------------------------------------------------------------------
# Moderation
# ---------------------------------------------------------------------------

class ModerationTests(ReviewTestBase):
    def setUp(self):
        super().setUp()
        self.buyer2 = make_user("buyer2@example.com", first="مینا", last="کریمی")
        buy(self.buyer2, self.book)

    def review(self, user=None, body="نظر من", rating=4):
        return Review.objects.create(user=user or self.buyer, book=self.book, rating=rating, body=body)

    def admin_list(self, **params):
        self.client.force_login(self.admin)
        res = self.client.get(reverse("admin:reviews_review_changelist"), params)
        self.assertEqual(res.status_code, 200)
        return list(res.context["cl"].result_list)

    def admin_action(self, action, reviews, **extra):
        self.client.force_login(self.admin)
        data = {"action": action, helpers.ACTION_CHECKBOX_NAME: [r.pk for r in reviews], **extra}
        return self.client.post(reverse("admin:reviews_review_changelist"), data)

    def test_new_review_is_visible_immediately(self):
        self.post_review(self.buyer, body="عالی")
        res = self.list_reviews(self.other)
        self.assertEqual([r["body"] for r in res.data["results"]], ["عالی"])
        self.assertIsNone(self.list_reviews(self.other).data["my_review"])

    def test_admin_list_has_only_reviews_with_text_last_submitted_first(self):
        older = self.review(self.buyer, body="قدیمی")
        Review.objects.filter(pk=older.pk).update(
            created_at=timezone.now() - timedelta(days=2), submitted_at=timezone.now() - timedelta(days=2)
        )
        newer = self.review(self.buyer2, body="جدید")
        third = make_user("third@example.com")
        buy(third, self.book)
        self.review(third, body="")  # rating only: nothing to moderate
        self.assertEqual(self.admin_list(), [newer, older])

    def test_author_edit_moves_review_to_top_and_resets_to_new(self):
        first = self.review(self.buyer, body="اول")
        second = self.review(self.buyer2, body="دوم")
        first.mark_checked(self.admin)
        created_at = first.created_at
        self.assertEqual(self.admin_list(), [second, first])

        self.client.force_authenticate(self.buyer)
        self.client.patch(mine_url(self.book), {"body": "اول، ویرایش‌شده"}, format="json")
        first.refresh_from_db()
        self.assertFalse(first.is_checked)
        self.assertIsNone(first.checked_by)
        self.assertEqual(first.created_at, created_at)
        self.assertTrue(first.is_edited)
        self.assertEqual(self.admin_list(), [first, second])
        self.assertEqual(self.admin_list(checked="new")[0], first)

    def test_hiding_requires_a_reason(self):
        review = self.review()
        for reason in ("", "   ", None):
            with self.assertRaises(ValidationError) as ctx:
                review.hide(self.admin, reason)
            self.assertIn(HIDE_REASON_REQUIRED, ctx.exception.messages)
        # The model rule on a plain save(), and the database constraint below it
        review.hidden_by, review.hidden_at = self.admin, timezone.now()
        with self.assertRaises(ValidationError):
            review.save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Review.objects.filter(pk=review.pk).update(hidden_by=self.admin, hidden_at=timezone.now())
        review.refresh_from_db()
        self.assertFalse(review.is_hidden)

    def test_hiding_records_admin_time_and_history(self):
        review = self.review()
        before = timezone.now()
        review.hide(self.admin, "  توهین به نویسنده  ")
        review.refresh_from_db()
        self.assertEqual(review.hidden_by, self.admin)
        self.assertGreaterEqual(review.hidden_at, before)
        self.assertEqual(review.hide_reason, "توهین به نویسنده")
        self.assertEqual(review.checked_by, self.admin)
        hide = review.hides.get()
        self.assertEqual((hide.hidden_by, hide.reason, hide.ended_at), (self.admin, "توهین به نویسنده", None))
        with self.assertRaises(ValidationError):
            review.hide(self.admin, "دوباره")

    def test_hidden_review_is_invisible_to_others_and_not_counted(self):
        hidden = self.review(self.buyer, rating=1, body="بد")
        self.review(self.buyer2, rating=5, body="خوب")
        hidden.hide(self.admin, "اسپم")

        for user in (None, self.other, self.buyer2):
            res = self.list_reviews(user)
            self.assertNotIn(hidden.pk, [r["id"] for r in res.data["results"]])
            detail = self.detail(user).data
            self.assertEqual((detail["rating_count"], detail["rating_average"]), (1, 5.0))
        listed = self.client.get(reverse("book_list_create")).data["results"][0]
        self.assertEqual((listed["rating_count"], listed["rating_average"]), (1, 5.0))
        # Not even for its author
        self.assertEqual(self.detail(self.buyer).data["rating_count"], 1)

    def test_author_sees_own_hidden_review_with_reason(self):
        review = self.review(body="نظر تند")
        review.hide(self.admin, "لحن توهین‌آمیز")
        res = self.list_reviews(self.buyer)
        mine = res.data["my_review"]
        self.assertEqual(mine["id"], review.pk)
        self.assertTrue(mine["is_hidden"])
        self.assertEqual(mine["hide_reason"], "لحن توهین‌آمیز")
        self.assertEqual(res.data["results"], [])
        self.assertTrue(self.detail(self.buyer).data["has_review"])

    def test_author_edit_republishes_marks_previously_hidden_and_keeps_history(self):
        review = self.review(body="نظر تند")
        review.hide(self.admin, "لحن توهین‌آمیز")
        self.client.force_authenticate(self.buyer)
        res = self.client.patch(mine_url(self.book), {"rating": 3, "body": "نظر مؤدبانه"}, format="json")
        self.assertFalse(res.data["is_hidden"])
        self.assertEqual(res.data["hide_reason"], "")

        review.refresh_from_db()
        self.assertFalse(review.is_hidden)
        self.assertEqual((review.hidden_by, review.hidden_at, review.hide_reason), (None, None, ""))
        self.assertFalse(review.is_checked)
        self.assertIn(review.pk, [r["id"] for r in self.list_reviews(self.other).data["results"]])

        hide = review.hides.get()
        self.assertEqual(hide.reason, "لحن توهین‌آمیز")
        self.assertEqual(hide.hidden_by, self.admin)
        self.assertEqual(hide.end_kind, ReviewHide.EndKind.AUTHOR_EDIT)
        self.assertIsNotNone(hide.ended_at)

        listed = self.admin_list()
        self.assertEqual(listed[0], review)
        self.assertTrue(listed[0].previously_hidden)
        self.assertEqual(self.admin_list(previously_hidden="yes"), [review])

    def test_hidden_rating_only_review_is_republished_by_edit_too(self):
        review = self.review(body="")
        review.hide(self.admin, "دلیل")
        review.author_submit(rating=2, body="")
        review.refresh_from_db()
        self.assertFalse(review.is_hidden)

    def test_admin_unhide(self):
        review = self.review()
        review.hide(self.admin, "اشتباهی")
        other_admin = make_admin("admin2@example.com")
        review.unhide(other_admin)
        review.refresh_from_db()
        self.assertFalse(review.is_hidden)
        self.assertEqual(review.hide_reason, "")
        self.assertEqual(review.checked_by, other_admin)
        hide = review.hides.get()
        self.assertEqual((hide.end_kind, hide.ended_by), (ReviewHide.EndKind.ADMIN_UNHIDE, other_admin))
        with self.assertRaises(ValidationError):
            review.unhide(other_admin)

    def test_moderation_state_never_leaks_to_other_users(self):
        hidden = self.review(self.buyer, body="پنهان")
        visible = self.review(self.buyer2, body="پیدا")
        visible.mark_checked(self.admin)
        hidden.hide(self.admin, "دلیل-محرمانه")

        bodies = [
            self.list_reviews(None).data, self.list_reviews(self.other).data,
            self.detail(self.other).data, self.client.get(reverse("book_list_create")).data,
            # Another reviewer: the other reviews they see (their own one is checked below)
            self.list_reviews(self.buyer2).data["results"],
        ]
        for data in bodies:
            keys = all_keys(data)
            self.assertFalse(keys & (MODERATION_KEYS | {"hide_reason", "is_hidden"}), keys)
            self.assertNotIn("دلیل-محرمانه", json.dumps(data, ensure_ascii=False, default=str))
        # buyer2's own (visible, checked) review: is_hidden false, nothing about checking
        mine = self.list_reviews(self.buyer2).data["my_review"]
        self.assertFalse(mine["is_hidden"])
        self.assertFalse(set(mine) & MODERATION_KEYS)
        # The author: hidden + reason, but not who hid it, when, or the history
        res = self.list_reviews(self.buyer)
        self.assertFalse(all_keys(res.data) & MODERATION_KEYS)
        self.assertNotIn(str(self.admin), json.dumps(res.data, ensure_ascii=False, default=str))

    def test_bulk_admin_actions_record_who_and_when(self):
        reviews = [self.review(self.buyer, body="الف"), self.review(self.buyer2, body="ب")]
        self.admin_action("mark_checked_selected", reviews)
        for review in reviews:
            review.refresh_from_db()
            self.assertEqual(review.checked_by, self.admin)
            self.assertIsNotNone(review.checked_at)

        # Hide without a reason: the form comes back, nothing is hidden
        res = self.admin_action("hide_selected", reviews, apply="1", reason="  ")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Review.objects.filter(hidden_at__isnull=False).exists())

        self.admin_action("hide_selected", reviews, apply="1", reason="اسپم تبلیغاتی")
        for review in reviews:
            review.refresh_from_db()
            self.assertEqual((review.hidden_by, review.hide_reason), (self.admin, "اسپم تبلیغاتی"))
            self.assertEqual(review.hides.count(), 1)

        self.admin_action("unhide_selected", reviews)
        for review in reviews:
            review.refresh_from_db()
            self.assertFalse(review.is_hidden)
            self.assertEqual(review.hides.get().ended_by, self.admin)


# ---------------------------------------------------------------------------
# Average and count
# ---------------------------------------------------------------------------

class RatingTests(ReviewTestBase):
    def test_no_reviews(self):
        detail = self.detail().data
        self.assertEqual((detail["rating_count"], detail["rating_average"]), (0, None))
        listed = self.client.get(reverse("book_list_create")).data["results"][0]
        self.assertEqual((listed["rating_count"], listed["rating_average"]), (0, None))

    def test_average_rounded_to_one_decimal(self):
        for i, rating in enumerate([5, 4, 4]):
            user = make_user(f"r{i}@example.com")
            buy(user, self.book)
            Review.objects.create(user=user, book=self.book, rating=rating)
        detail = self.detail().data
        self.assertEqual((detail["rating_count"], detail["rating_average"]), (3, 4.3))

    def test_correct_with_several_purchases_reviews_and_joins(self):
        # Three buyers and three reviews on one book, two authors (an M2M join for
        # ?search=), plus a second book: a JOIN-based count would come out 9, 18 or 27
        book = BookFactory.make(self.seller, author="نویسنده یک")
        book.authors.add(Person.objects.create(name="نویسنده دو"))
        other_book = BookFactory.make(self.seller, author="نویسنده یک")
        for i, rating in enumerate([5, 3, 1]):
            user = make_user(f"multi{i}@example.com")
            buy(user, book)
            buy(user, other_book)
            Review.objects.create(user=user, book=book, rating=rating)
        Review.objects.create(user=user, book=other_book, rating=2)

        self.client.force_authenticate(user)
        for params in ({}, {"search": "نویسنده"}):
            results = {b["id"]: b for b in self.client.get(reverse("book_list_create"), params).data["results"]}
            self.assertEqual((results[book.pk]["rating_count"], results[book.pk]["rating_average"]), (3, 3.0))
            self.assertEqual((results[other_book.pk]["rating_count"], results[other_book.pk]["rating_average"]), (1, 2.0))
        detail = self.detail(user, book).data
        self.assertEqual((detail["rating_count"], detail["rating_average"]), (3, 3.0))

    def test_book_list_query_count_does_not_grow_with_books(self):
        url = reverse("book_list_create")
        self.client.force_authenticate(self.buyer)
        Review.objects.create(user=self.buyer, book=self.book, rating=5)
        with CaptureQueriesContext(connection) as one_book:
            self.client.get(url)
        for i in range(3):
            book = BookFactory.make(self.seller)
            user = make_user(f"q{i}@example.com")
            buy(user, book)
            Review.objects.create(user=user, book=book, rating=3)
        with CaptureQueriesContext(connection) as four_books:
            self.client.get(url)
        self.assertEqual(len(one_book), len(four_books))

    def test_review_list_is_paginated_newest_first_without_own_review(self):
        users = []
        for i in range(12):
            user = make_user(f"p{i}@example.com")
            buy(user, self.book)
            users.append(user)
            Review.objects.create(user=user, book=self.book, rating=4, body=f"نظر {i}")
        Review.objects.create(user=self.buyer, book=self.book, rating=5, body="مال خودم")
        res = self.list_reviews(self.buyer)
        self.assertEqual(res.data["count"], 12)
        self.assertEqual(len(res.data["results"]), 10)
        self.assertEqual(res.data["results"][0]["body"], "نظر 11")
        self.assertEqual(res.data["my_review"]["body"], "مال خودم")
        self.assertIsNotNone(res.data["next"])
