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
        username=name, email=f"{name}@example.com", password="Str0ng-Passw0rd!"
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

    def test_pending_book_does_not_count_as_available(self):
        Book.objects.create(
            title="x", isbn=ISBN, price=0, status=Book.Status.PENDING,
            uploaded_by=self.sara, book_file="books/files/x.pdf",
        )
        self.assertEqual(self.post(self.ali).status_code, status.HTTP_201_CREATED)

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
            username="boss", email="boss@example.com", password="Str0ng-Passw0rd!"
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
