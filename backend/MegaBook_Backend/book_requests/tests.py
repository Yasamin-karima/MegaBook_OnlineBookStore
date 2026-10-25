import threading

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework import status
from rest_framework.test import APITestCase

from catalog.isbn import ISBN_CHECKSUM
from catalog.models import Book

from .models import REJECTION_REASON_REQUIRED, BookRequest, RequestEntry
from .services import submit_request

URL = "/book-requests/"
ISBN = "9789643113445"  # سمفونی مردگان
SUCCESS = {"result": "requested", "message": "درخواست شما ثبت شد", "isbn": ISBN}


def make_user(name):
    return get_user_model().objects.create_user(
        first_name=name, last_name="Test", email=f"{name}@example.com", password="Str0ng-Passw0rd!"
    )


class BookRequestApiTests(APITestCase):
    def setUp(self):
        self.sara = make_user("sara")
        self.ali = make_user("ali")

    def post(self, user, **overrides):
        self.client.force_authenticate(user)
        data = {"isbn": "978-964-311-344-5", "title": "سمفونی مردگان", "authors": "عباس معروفی", **overrides}
        return self.client.post(URL, data, format="json")

    # --- ثبت ---

    def test_first_request_creates_one_request_and_one_entry(self):
        res = self.post(self.sara, notes="چاپ ققنوس", cover_url="https://covers.openlibrary.org/b/id/1-L.jpg")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data, SUCCESS)

        book_request = BookRequest.objects.get()
        self.assertEqual(book_request.isbn, ISBN)  # با خط تیره فرستاده شد، ۱۳ رقمی ذخیره شد
        self.assertEqual(book_request.title, "سمفونی مردگان")
        self.assertEqual(book_request.status, BookRequest.Status.OPEN)
        entry = RequestEntry.objects.get()
        self.assertEqual(entry.requester, self.sara)
        self.assertEqual(entry.notes, "چاپ ققنوس")

    def test_persian_digits_and_isbn10_are_normalized(self):
        self.post(self.sara, isbn="۹۶۴-۳۱۱-۳۴۴-۲")
        self.assertEqual(BookRequest.objects.get().isbn, ISBN)

    def test_second_user_adds_entry_and_gets_identical_response(self):
        first = self.post(self.sara)
        second = self.post(self.ali, title="عنوان دیگر", notes="من هم می‌خواهم")

        # همان کد و همان بدنه: فرانت نمی‌تواند بفهمد کس دیگری قبلاً درخواست داده
        self.assertEqual(second.status_code, first.status_code)
        self.assertEqual(second.data, first.data)
        self.assertEqual(BookRequest.objects.count(), 1)
        self.assertEqual(RequestEntry.objects.count(), 2)
        # اطلاعات اولین درخواست‌کننده می‌ماند
        self.assertEqual(BookRequest.objects.get().title, "سمفونی مردگان")

    def test_same_user_twice_is_refused(self):
        self.post(self.sara)
        res = self.post(self.sara)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["result"], "already_requested")
        self.assertEqual(res.data["message"], "قبلاً این کتاب را درخواست داده‌اید")
        self.assertEqual(RequestEntry.objects.count(), 1)

    def test_rejected_isbn_is_refused_for_any_user_with_reason(self):
        self.post(self.sara)
        book_request = BookRequest.objects.get()
        book_request.status = BookRequest.Status.REJECTED
        book_request.rejection_reason = "حق نشر این کتاب در دسترس نیست."
        book_request.save()

        for user in (self.sara, self.ali, make_user("reza")):
            res = self.post(user)
            self.assertEqual(res.status_code, status.HTTP_409_CONFLICT, user)
            self.assertEqual(res.data["result"], "rejected")
            self.assertEqual(res.data["rejection_reason"], "حق نشر این کتاب در دسترس نیست.")
        self.assertEqual(RequestEntry.objects.count(), 1)

    def test_approved_book_returns_available_and_creates_nothing(self):
        book = Book.objects.create(
            title="سمفونی مردگان", isbn=ISBN, price=0, status=Book.Status.APPROVED,
            uploaded_by=self.sara, book_file="books/files/x.pdf",
        )
        res = self.post(self.ali)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["result"], "available")
        self.assertEqual(res.data["book_id"], book.id)
        self.assertEqual(BookRequest.objects.count(), 0)
        self.assertEqual(RequestEntry.objects.count(), 0)

    def test_pending_book_returns_in_review_and_creates_nothing(self):
        Book.objects.create(
            title="x", isbn=ISBN, price=0, status=Book.Status.PENDING,
            uploaded_by=self.sara, book_file="books/files/x.pdf",
        )
        res = self.post(self.ali)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["result"], "in_review")
        self.assertEqual(res.data["message"], "این کتاب بارگذاری شده و در انتظار بررسی است.")
        self.assertEqual(BookRequest.objects.count(), 0)

    def test_rejected_book_does_not_block_request(self):
        # کتاب رد شده دوباره قابل بارگذاری است، پس درخواستش هم معنا دارد
        Book.objects.create(
            title="x", isbn=ISBN, price=0, status=Book.Status.REJECTED, rejection_reason="فایل ناقص",
            uploaded_by=self.sara, book_file="books/files/x.pdf",
        )
        res = self.post(self.ali)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["result"], "requested")

    def test_fulfilled_request_accepts_new_entry(self):
        self.post(self.sara)
        BookRequest.objects.update(status=BookRequest.Status.FULFILLED)
        res = self.post(self.ali)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data, SUCCESS)
        self.assertEqual(RequestEntry.objects.count(), 2)

    def test_reopening_clears_reason_and_new_users_can_request(self):
        self.post(self.sara)
        book_request = BookRequest.objects.get()
        book_request.status = BookRequest.Status.REJECTED
        book_request.rejection_reason = "دلیل"
        book_request.save()
        self.assertEqual(self.post(self.ali).data["result"], "rejected")

        book_request.status = BookRequest.Status.OPEN
        book_request.save()
        book_request.refresh_from_db()
        self.assertEqual(book_request.rejection_reason, "")

        res = self.post(self.ali)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(RequestEntry.objects.count(), 2)

    # --- ورودی ---

    def test_client_cannot_set_requester_or_status(self):
        res = self.post(self.sara, status="fulfilled", requester=self.ali.id)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(BookRequest.objects.get().status, BookRequest.Status.OPEN)
        self.assertEqual(RequestEntry.objects.get().requester, self.sara)

    def test_title_is_required(self):
        res = self.post(self.sara, title="")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["title"], ["عنوان کتاب را وارد کنید."])
        self.assertEqual(BookRequest.objects.count(), 0)

    def test_invalid_isbn(self):
        res = self.post(self.sara, isbn="9789643113446")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["isbn"], [ISBN_CHECKSUM])

    def test_notes_too_long(self):
        res = self.post(self.sara, notes="x" * 501)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("notes", res.data)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        res = self.client.post(URL, {"isbn": ISBN, "title": "x"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(BookRequest.objects.count(), 0)


class BookRequestModelRuleTests(TestCase):
    def test_saving_rejected_without_reason_fails(self):
        book_request = BookRequest(isbn=ISBN, title="x", status=BookRequest.Status.REJECTED, rejection_reason="  ")
        # save() ساده: قانون همچنان اعمال می‌شود، حتی بدون full_clean
        with self.assertRaises(ValidationError):
            book_request.save()
        self.assertEqual(BookRequest.objects.count(), 0)

    def test_full_clean_reports_error_on_reason_field(self):
        # همان مسیری که فرم ادمین طی می‌کند؛ خطا کنار فیلد rejection_reason نشان داده می‌شود
        book_request = BookRequest(isbn=ISBN, title="x", status=BookRequest.Status.REJECTED)
        with self.assertRaises(ValidationError) as ctx:
            book_request.full_clean()
        self.assertEqual(ctx.exception.message_dict["rejection_reason"], [REJECTION_REASON_REQUIRED])

    def test_any_direction_allowed_and_reason_cleared_when_not_rejected(self):
        book_request = BookRequest.objects.create(isbn=ISBN, title="x")
        for new_status in ("fulfilled", "rejected", "open", "rejected", "fulfilled"):
            book_request.status = new_status
            book_request.rejection_reason = "دلیل" if new_status == "rejected" else "باید پاک شود"
            book_request.save()
            book_request.refresh_from_db()
            expected = "دلیل" if new_status == "rejected" else ""
            self.assertEqual(book_request.rejection_reason, expected, new_status)


class ConcurrentRequestTests(TransactionTestCase):
    """چند کاربر هم‌زمان یک شابک جدید را درخواست می‌کنند.

    TransactionTestCase (نه TestCase) چون هر thread اتصال دیتابیس خودش را دارد و باید
    تراکنش‌های واقعی و commitشده‌ی بقیه را ببیند.
    """

    def test_simultaneous_first_requests_create_one_book_request(self):
        users = [make_user(f"user{i}") for i in range(6)]
        start = threading.Barrier(len(users))
        results, errors = [], []

        def submit(user):
            try:
                start.wait()  # همه با هم شروع کنند
                results.append(submit_request(user, isbn=ISBN, title="سمفونی مردگان").result)
            except Exception as error:  # noqa: BLE001 - خطا را به thread اصلی برمی‌گردانیم
                errors.append(error)
            finally:
                connection.close()

        threads = [threading.Thread(target=submit, args=(user,)) for user in users]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        self.assertEqual(results, ["requested"] * len(users))
        self.assertEqual(BookRequest.objects.count(), 1)
        self.assertEqual(RequestEntry.objects.count(), len(users))


class AdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(
            first_name="boss", last_name="Test", email="boss@example.com", password="Str0ng-Passw0rd!"
        )
        self.client.force_login(self.admin)
        self.book_request = BookRequest.objects.create(isbn=ISBN, title="سمفونی مردگان")
        for name in ("sara", "ali"):
            RequestEntry.objects.create(request=self.book_request, requester=make_user(name), notes=f"یادداشت {name}")

    def test_list_shows_requester_count(self):
        res = self.client.get("/admin/book_requests/bookrequest/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "تعداد درخواست‌کننده")
        self.assertEqual(res.context["cl"].result_list[0].requester_count, 2)

    def test_change_form_shows_requesters_inline(self):
        res = self.client.get(f"/admin/book_requests/bookrequest/{self.book_request.pk}/change/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "یادداشت sara")
        self.assertContains(res, "یادداشت ali")

    def test_rejecting_without_reason_shows_field_error(self):
        url = f"/admin/book_requests/bookrequest/{self.book_request.pk}/change/"
        data = {
            "isbn": ISBN, "title": "سمفونی مردگان", "authors": "", "cover_url": "",
            "status": "rejected", "rejection_reason": "",
            # فرم inline هم باید فرستاده شود (management form)
            "entries-TOTAL_FORMS": "2", "entries-INITIAL_FORMS": "2",
            "entries-MIN_NUM_FORMS": "0", "entries-MAX_NUM_FORMS": "1000",
            "entries-0-id": str(self.book_request.entries.all()[0].pk), "entries-0-request": str(self.book_request.pk),
            "entries-1-id": str(self.book_request.entries.all()[1].pk), "entries-1-request": str(self.book_request.pk),
        }
        res = self.client.post(url, data)
        self.assertEqual(res.status_code, 200)  # فرم دوباره نمایش داده شد، نه خطای ۵۰۰
        self.assertEqual(res.context["adminform"].form.errors["rejection_reason"], [REJECTION_REASON_REQUIRED])
        self.book_request.refresh_from_db()
        self.assertEqual(self.book_request.status, BookRequest.Status.OPEN)


class DatabaseConstraintTests(TestCase):
    """قیدهای دیتابیس به‌تنهایی، بدون کمک serializer یا save()."""

    def setUp(self):
        self.user = make_user("sara")
        self.book_request = BookRequest.objects.create(isbn=ISBN, title="x")

    def test_isbn_is_unique(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookRequest.objects.create(isbn=ISBN, title="دوباره")

    def test_one_entry_per_user_per_request(self):
        RequestEntry.objects.create(request=self.book_request, requester=self.user)
        with self.assertRaises(IntegrityError), transaction.atomic():
            RequestEntry.objects.create(request=self.book_request, requester=self.user)

    def test_check_constraint_blocks_update_that_skips_save(self):
        # QuerySet.update() از save() رد می‌شود؛ قید CHECK دیتابیس جلویش را می‌گیرد
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookRequest.objects.filter(pk=self.book_request.pk).update(status="rejected")
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookRequest.objects.filter(pk=self.book_request.pk).update(rejection_reason="بدون رد شدن")


# ---------------------------------------------------------------------------
# Public list and "I want this too"
# ---------------------------------------------------------------------------

def open_request(isbn, title="کتاب", *requesters, **fields):
    book_request = BookRequest.objects.create(isbn=isbn, title=title, authors="نویسنده", **fields)
    for user in requesters:
        RequestEntry.objects.create(request=book_request, requester=user)
    return book_request


class PublicListTests(APITestCase):
    def setUp(self):
        self.sara = make_user("sara")
        self.ali = make_user("ali")
        self.reza = make_user("reza")
        self.one = open_request("9780000000011", "یک نفر", self.sara)
        self.many = open_request("9780000000012", "سه نفر", self.sara, self.ali, self.reza)
        open_request("9780000000013", "تأمین‌شده", self.ali, status=BookRequest.Status.FULFILLED)
        open_request("9780000000014", "ردشده", self.ali, status=BookRequest.Status.REJECTED, rejection_reason="حق نشر")

    def items(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_anonymous_sees_only_open_requests_with_no_personal_data(self):
        data = self.items()
        self.assertEqual(data["count"], 2)
        self.assertEqual({r["title"] for r in data["results"]}, {"یک نفر", "سه نفر"})
        self.assertEqual(set(data["results"][0]), {
            "id", "isbn", "title", "authors", "cover", "created_at", "requester_count", "is_mine", "book_in_review",
        })
        body = self.client.get(URL).content.decode()
        for user in (self.sara, self.ali, self.reza):
            self.assertNotIn(user.email, body)
            self.assertNotIn(user.first_name, body)
        for key in ("requester", "requesters", "requester_id", "email", "phone", "user", "user_id", "notes", "first_name"):
            self.assertNotIn(f'"{key}":', body)
        self.assertFalse(any(r["is_mine"] for r in data["results"]))

    def test_requester_counts(self):
        counts = {r["title"]: r["requester_count"] for r in self.items()["results"]}
        self.assertEqual(counts, {"یک نفر": 1, "سه نفر": 3})

    def test_is_mine_for_a_logged_in_user(self):
        alone = make_user("alone")
        RequestEntry.objects.create(request=self.one, requester=alone)
        self.client.force_authenticate(alone)
        mine = {r["title"]: r["is_mine"] for r in self.items()["results"]}
        self.assertEqual(mine, {"یک نفر": True, "سه نفر": False})

    def test_ordering_and_pagination(self):
        for i in range(12):
            open_request(f"97800000001{i:02d}", f"تازه {i}")
        newest = self.items()
        self.assertEqual(newest["count"], 14)
        self.assertEqual(len(newest["results"]), 10)
        self.assertEqual(newest["results"][0]["title"], "تازه 11")
        self.assertEqual(len(self.items(page=2)["results"]), 4)
        most = self.items(ordering="most_requested")["results"]
        self.assertEqual([r["requester_count"] for r in most[:2]], [3, 1])

    def test_search_by_title_and_persian_isbn(self):
        self.assertEqual(self.items(search="سه")["count"], 1)
        self.assertEqual(self.items(search="۹۷۸-۰۰۰۰۰۰۰۰۱۱")["results"][0]["title"], "یک نفر")

    def test_book_in_review_flag(self):
        Book.objects.create(
            title="x", isbn=self.one.isbn, status=Book.Status.PENDING, uploaded_by=self.ali, book_file="books/files/x.pdf",
        )
        flags = {r["title"]: r["book_in_review"] for r in self.items()["results"]}
        self.assertEqual(flags, {"یک نفر": True, "سه نفر": False})

    def test_query_count_does_not_grow(self):
        for i in range(8):
            open_request(f"97800000002{i:02d}", "x", self.sara, self.ali)
        self.client.force_authenticate(self.reza)
        with self.assertNumQueries(2):
            self.client.get(URL)


class JoinRequestTests(APITestCase):
    def setUp(self):
        self.sara = make_user("sara")
        self.ali = make_user("ali")
        self.book_request = open_request("9780000000011", "کتاب", self.sara)

    def join(self, user, pk=None):
        self.client.force_authenticate(user)
        return self.client.post(f"{URL}{pk or self.book_request.pk}/join/")

    def test_join_then_join_again_creates_one_entry(self):
        first = self.join(self.ali)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data["request"]["requester_count"], 2)
        self.assertTrue(first.data["request"]["is_mine"])

        second = self.join(self.ali)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data["request"]["requester_count"], 2)
        self.assertEqual(RequestEntry.objects.filter(request=self.book_request, requester=self.ali).count(), 1)
        self.assertNotIn("email", str(second.data))

    def test_anonymous_rejected(self):
        response = self.client.post(f"{URL}{self.book_request.pk}/join/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(RequestEntry.objects.count(), 1)

    def test_not_open_anymore(self):
        for new_status, reason in ((BookRequest.Status.FULFILLED, ""), (BookRequest.Status.REJECTED, "حق نشر")):
            self.book_request.status, self.book_request.rejection_reason = new_status, reason
            self.book_request.save()
            response = self.join(self.ali)
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
            self.assertEqual(response.data["result"], "not_open")
            self.assertIn("دیگر باز نیست", response.data["message"])
        self.assertEqual(RequestEntry.objects.count(), 1)

    def test_missing_request(self):
        self.assertEqual(self.join(self.ali, pk=999_999).status_code, status.HTTP_404_NOT_FOUND)

    def test_isbn_form_still_accepts_a_fulfilled_request(self):
        # require_open is only for the public list; the ISBN form keeps its rules (5.6)
        self.book_request.status = BookRequest.Status.FULFILLED
        self.book_request.save()
        outcome = submit_request(self.ali, isbn=self.book_request.isbn, title="x")
        self.assertEqual(outcome.result, "requested")


class ConcurrentJoinTests(TransactionTestCase):
    def test_double_click_creates_one_entry(self):
        sara, ali = make_user("sara"), make_user("ali")
        book_request = open_request("9780000000011", "کتاب", sara)
        barrier = threading.Barrier(2)
        results = []

        def worker():
            try:
                barrier.wait()
                results.append(submit_request(
                    ali, isbn=book_request.isbn, title=book_request.title, require_open=True,
                ).result)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        self.assertEqual(sorted(results), ["already_requested", "requested"])
        self.assertEqual(RequestEntry.objects.filter(request=book_request).count(), 2)


# ---------------------------------------------------------------------------
# The request follows the store: approved book -> fulfilled (DECISIONS 5.14)
# ---------------------------------------------------------------------------

from io import StringIO  # noqa: E402

from django.core.management import call_command  # noqa: E402

from support import services as support_services  # noqa: E402
from support.models import Conversation  # noqa: E402


class BookOnSaleSyncTests(APITestCase):
    ISBN_A = "9780000000301"
    ISBN_B = "9780000000302"

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(
            email="admin@example.com", first_name="a", last_name="b", password="Str0ng-Passw0rd!"
        )
        self.alef, self.be, self.jim = make_user("alef"), make_user("be"), make_user("jim")

    def request(self, isbn, *users):
        book_request = BookRequest.objects.create(isbn=isbn, title="کتاب")
        for user in users:
            RequestEntry.objects.create(request=book_request, requester=user)
        return book_request

    def upload(self, isbn, user, status=Book.Status.PENDING):
        return Book.objects.create(
            title="کتاب", isbn=isbn, status=status, price=None if status != Book.Status.APPROVED else 10_000,
            uploaded_by=user, book_file="books/files/x.pdf",
        )

    def approve(self, book):
        book.status, book.price = Book.Status.APPROVED, 10_000
        book.save()

    def public_titles(self):
        return {r["isbn"] for r in self.client.get(URL).data["results"]}

    def test_the_reported_path(self):
        # الف requests two books; الف uploads one, ب the other
        req_h = self.request(self.ISBN_A, self.alef, self.jim)
        req_y = self.request(self.ISBN_B, self.alef)
        book_h = self.upload(self.ISBN_A, self.alef)
        book_y = self.upload(self.ISBN_B, self.be)
        flags = {r["isbn"]: r["book_in_review"] for r in self.client.get(URL).data["results"]}
        self.assertEqual(flags, {self.ISBN_A: True, self.ISBN_B: True})

        self.approve(book_h)
        self.approve(book_y)
        req_h.refresh_from_db()
        req_y.refresh_from_db()
        self.assertEqual((req_h.status, req_y.status), ("fulfilled", "fulfilled"))
        self.assertEqual(self.public_titles(), set())  # off the public list

        # Every requester is told, and their conversation closes automatically
        for entry in req_h.entries.all():
            conversation = support_services.find(entry)
            self.assertEqual(conversation.closed_kind, "fulfilled")
            self.assertIn("تأمین شد", conversation.messages.last().body)

        # "My Requests": fulfilled, with the link to the store's book
        self.client.force_authenticate(self.jim)
        item = self.client.get("/dashboard/requests/").data["results"][0]
        self.assertEqual((item["status"], item["book_id"]), ("fulfilled", book_h.pk))

    def test_admin_upload_created_approved_fulfils_too(self):
        book_request = self.request(self.ISBN_A, self.alef)
        self.upload(self.ISBN_A, self.admin, status=Book.Status.APPROVED)
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "fulfilled")

    def test_rejected_request_is_left_alone(self):
        book_request = self.request(self.ISBN_A, self.alef)
        book_request.status, book_request.rejection_reason = "rejected", "حق نشر"
        book_request.save()
        self.approve(self.upload(self.ISBN_A, self.be))
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "rejected")

    def test_leaving_the_store_reopens_but_keeps_manual_closes(self):
        book_request = self.request(self.ISBN_A, self.alef, self.jim)
        jim_entry = book_request.entries.get(requester=self.jim)
        support_services.post_user_message(self.jim, jim_entry, "سلام")
        support_services.close(support_services.find(jim_entry), self.admin, "مزاحمت")
        book = self.upload(self.ISBN_A, self.be)
        self.approve(book)

        book.status = Book.Status.REJECTED
        book.rejection_reason = "فایل ناقص"
        book.save()
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "open")
        alef_conversation = support_services.find(book_request.entries.get(requester=self.alef))
        self.assertFalse(alef_conversation.is_closed)
        self.assertEqual(support_services.find(jim_entry).closed_kind, "support")
        self.assertEqual(self.public_titles(), {self.ISBN_A})

    def test_back_to_pending_shows_in_review_again(self):
        book_request = self.request(self.ISBN_A, self.alef)
        book = self.upload(self.ISBN_A, self.be)
        self.approve(book)
        book.status = Book.Status.PENDING
        book.save()
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "open")
        self.assertTrue(self.client.get(URL).data["results"][0]["book_in_review"])

    def test_unrelated_save_changes_nothing(self):
        book_request = self.request(self.ISBN_A, self.alef)
        book = self.upload(self.ISBN_A, self.be)
        book.title = "عنوان تازه"
        book.save()
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "open")
        self.assertEqual(Conversation.objects.count(), 0)


class FulfilCommandTests(TestCase):
    def test_fixes_old_data_with_messages_and_is_repeatable(self):
        alef = make_user("alef")
        book_request = BookRequest.objects.create(isbn="9780000000401", title="کتاب")
        entry = RequestEntry.objects.create(request=book_request, requester=alef)
        other = BookRequest.objects.create(isbn="9780000000402", title="بی‌کتاب")
        # An approved book that existed BEFORE the sync rule: write it without save()
        book = Book.objects.create(
            title="کتاب", isbn="9780000000401", status=Book.Status.PENDING, uploaded_by=alef,
            book_file="books/files/x.pdf",
        )
        Book.objects.filter(pk=book.pk).update(status=Book.Status.APPROVED, price=0)
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "open")

        out = StringIO()
        call_command("fulfil_requests_on_sale", "--dry-run", stdout=out)
        book_request.refresh_from_db()
        self.assertEqual(book_request.status, "open")
        self.assertIn("1 request(s) would be fulfilled", out.getvalue())

        call_command("fulfil_requests_on_sale", stdout=StringIO())
        book_request.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual((book_request.status, other.status), ("fulfilled", "open"))
        self.assertEqual(support_services.find(entry).closed_kind, "fulfilled")

        out = StringIO()
        call_command("fulfil_requests_on_sale", stdout=out)
        self.assertIn("0 request(s) fulfilled", out.getvalue())
