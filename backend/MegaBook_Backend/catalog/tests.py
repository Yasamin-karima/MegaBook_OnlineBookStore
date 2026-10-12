import io
import shutil
import tempfile
from unittest import mock

import requests
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from .isbn import ISBN_EMPTY, ISBN_FORMAT, InvalidISBN, normalize_isbn
from .models import Book, Category, Person, Publisher, Tag
from .serializers import ISBN_CHECKSUM, ISBN_LENGTH, ISBN_TAKEN

# فایل‌های آپلودی تست در یک پوشه‌ی موقت ذخیره می‌شوند، نه در media/ واقعی
TEMP_MEDIA = tempfile.mkdtemp()

VALID_ISBN = "9780306406157"


def png_file(name="cover.png"):
    buffer = io.BytesIO()
    Image.new("RGB", (10, 15), "blue").save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


def pdf_file(name="book.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4\n%test\n", content_type="application/pdf")


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class BookCreateTests(APITestCase):
    url = "/catalog/books/"

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="sara", email="sara@example.com", password="Str0ng-Passw0rd!"
        )
        self.category = Category.objects.create(name="داستان و رمان")
        self.client.force_authenticate(self.user)

    def payload(self, **overrides):
        # همان کلیدهایی که buildFormData در فرانت می‌سازد
        data = {
            "title": "کتابخانه نیمه‌شب",
            "isbn": VALID_ISBN,
            "language": "en",
            "price": "120000",
            "authors": ["مت هیگ"],
            "translators": ["مترجم یک", "مترجم دو"],
            "tags": ["فلسفه", "رمان"],
            "publisher": "نشر نمونه",
            "category": str(self.category.id),
            "original_title": "The Midnight Library",
            "page_count": "342",
            "publication_year": "2023",
            "cover": png_file(),
            "book_file": pdf_file(),
            "sample_file": pdf_file("sample.pdf"),
        }
        data.update(overrides)
        return {k: v for k, v in data.items() if v is not None}

    def post(self, **overrides):
        return self.client.post(self.url, self.payload(**overrides), format="multipart")

    def test_creates_book_with_relations_and_files(self):
        res = self.post()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)

        book = Book.objects.get(isbn=VALID_ISBN)
        self.assertEqual(book.uploaded_by, self.user)
        self.assertEqual(book.status, Book.Status.PENDING)
        self.assertEqual(book.category, self.category)
        self.assertEqual(book.publisher.name, "نشر نمونه")
        self.assertEqual([p.name for p in book.authors.all()], ["مت هیگ"])
        self.assertCountEqual([p.name for p in book.translators.all()], ["مترجم یک", "مترجم دو"])
        self.assertCountEqual([t.name for t in book.tags.all()], ["فلسفه", "رمان"])
        self.assertTrue(book.cover.name.startswith("books/covers/"))
        self.assertTrue(book.book_file.name.startswith("books/files/"))
        self.assertTrue(book.sample_file.name.startswith("books/samples/"))
        self.assertEqual(res.data["authors"], ["مت هیگ"])
        # فایل کامل کتاب محتوای پولی است؛ حتی به خود بارگذارنده هم آدرسش برنمی‌گردد
        self.assertNotIn("book_file", res.data)

    def test_only_required_fields(self):
        res = self.client.post(self.url, {
            "title": "حداقل", "isbn": VALID_ISBN, "language": "fa", "price": "0",
            "authors": ["نویسنده"], "cover": png_file(), "book_file": pdf_file(),
        }, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        book = Book.objects.get()
        self.assertIsNone(book.publisher)
        self.assertIsNone(book.category)
        self.assertFalse(book.sample_file)

    def test_reuses_existing_people_publisher_and_tags(self):
        Person.objects.create(name="مت هیگ")
        Publisher.objects.create(name="نشر نمونه")
        Tag.objects.create(name="فلسفه")
        self.assertEqual(self.post().status_code, status.HTTP_201_CREATED)
        self.assertEqual(Person.objects.filter(name="مت هیگ").count(), 1)
        self.assertEqual(Publisher.objects.count(), 1)
        self.assertEqual(Tag.objects.filter(name="فلسفه").count(), 1)

    def test_client_cannot_set_status_or_uploader(self):
        other = get_user_model().objects.create_user(username="x", email="x@example.com", password="Str0ng-Passw0rd!")
        res = self.post(status="approved", uploaded_by=str(other.id))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        book = Book.objects.get()
        self.assertEqual(book.status, Book.Status.PENDING)
        self.assertEqual(book.uploaded_by, self.user)

    def test_isbn_wrong_length(self):
        res = self.post(isbn="12345")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["isbn"], [ISBN_LENGTH])

    def test_isbn_wrong_check_digit(self):
        res = self.post(isbn="9780306406158")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["isbn"], [ISBN_CHECKSUM])

    def test_isbn_already_used(self):
        self.post()
        res = self.post(cover=png_file(), book_file=pdf_file())
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["isbn"], [ISBN_TAKEN])
        self.assertEqual(Book.objects.count(), 1)

    def test_missing_required_fields_give_persian_errors(self):
        res = self.client.post(self.url, {}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        for field in ["title", "isbn", "language", "price", "authors", "cover", "book_file"]:
            self.assertIn(field, res.data)
        self.assertEqual(res.data["authors"], ["دست‌کم نام یک نویسنده را وارد کنید."])
        self.assertEqual(res.data["cover"], ["تصویر جلد را انتخاب کنید."])

    def test_rejects_non_pdf_book_file(self):
        fake = SimpleUploadedFile("book.pdf", b"not really a pdf", content_type="application/pdf")
        res = self.post(book_file=fake)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["book_file"], ["فقط فایل PDF پذیرفته می‌شود."])

    def test_unknown_category(self):
        res = self.post(category="9999")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["category"], ["این دسته‌بندی وجود ندارد."])

    def test_nothing_saved_when_invalid(self):
        self.post(isbn="9780306406158")
        self.assertEqual(Book.objects.count(), 0)
        self.assertEqual(Person.objects.count(), 0)
        self.assertEqual(Publisher.objects.count(), 0)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        res = self.post()
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(Book.objects.count(), 0)


class CategoryListTests(APITestCase):
    def test_lists_categories_for_anyone(self):
        Category.objects.create(name="کودکان")
        Category.objects.create(name="کلاسیک")
        res = self.client.get("/catalog/categories/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual({c["name"] for c in res.data}, {"کودکان", "کلاسیک"})
        self.assertEqual(set(res.data[0].keys()), {"id", "name"})


READ_MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=READ_MEDIA)
class BookReadApiTests(APITestCase):
    list_url = "/catalog/books/"

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(READ_MEDIA, ignore_errors=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="uploader", email="u@example.com", password="Str0ng-Passw0rd!"
        )
        self.science = Category.objects.create(name="علمی")
        self.novel = Category.objects.create(name="داستان و رمان")
        self.counter = 0

    def make_book(self, title, status=Book.Status.APPROVED, authors=("نویسنده",), category=None, **extra):
        # کتاب را مستقیم در دیتابیس می‌سازیم (نه از API) تا وضعیت را آزادانه تعیین کنیم
        self.counter += 1
        book = Book.objects.create(
            title=title,
            isbn=f"978000000{self.counter:04d}",
            price=1000,
            status=status,
            category=category,
            uploaded_by=self.user,
            cover=png_file(f"c{self.counter}.png"),
            book_file=pdf_file(f"b{self.counter}.pdf"),
            **extra,
        )
        book.authors.set([Person.objects.get_or_create(name=n)[0] for n in authors])
        return book

    def titles(self, res):
        return [b["title"] for b in res.data["results"]]

    # --- فقط کتاب‌های تاییدشده ---

    def test_list_returns_only_approved_books(self):
        self.make_book("تاییدشده")
        self.make_book("در انتظار", status=Book.Status.PENDING)
        self.make_book("ردشده", status=Book.Status.REJECTED)
        res = self.client.get(self.list_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(self.titles(res), ["تاییدشده"])
        self.assertEqual(res.data["count"], 1)

    def test_detail_of_unapproved_book_is_404(self):
        pending = self.make_book("در انتظار", status=Book.Status.PENDING)
        rejected = self.make_book("ردشده", status=Book.Status.REJECTED)
        for book in (pending, rejected):
            res = self.client.get(f"{self.list_url}{book.id}/")
            self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_public_without_login(self):
        book = self.make_book("عمومی")
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(f"{self.list_url}{book.id}/").status_code, status.HTTP_200_OK)

    # --- شکل پاسخ ---

    def test_list_item_shape(self):
        self.make_book("کتاب", authors=("الف", "ب"), category=self.science, language="fa")
        item = self.client.get(self.list_url).data["results"][0]
        self.assertEqual(
            set(item.keys()),
            {"id", "title", "authors", "cover", "price", "category", "language", "created_at"},
        )
        self.assertCountEqual(item["authors"], ["الف", "ب"])
        self.assertEqual(item["category"], {"id": self.science.id, "name": "علمی"})
        self.assertTrue(item["cover"].startswith("http://testserver/media/books/covers/"))

    def test_detail_shape(self):
        book = self.make_book(
            "کتاب", category=self.science, original_title="Book", description="توضیح",
            page_count=100, publication_year=1403, edition="دوم",
            sample_file=pdf_file("s.pdf"), publisher=Publisher.objects.create(name="نشر نمونه"),
        )
        book.translators.set([Person.objects.create(name="مترجم")])
        book.tags.set([Tag.objects.create(name="فلسفه")])

        data = self.client.get(f"{self.list_url}{book.id}/").data
        self.assertEqual(
            set(data.keys()),
            {"id", "title", "authors", "cover", "price", "category", "language", "created_at",
             "original_title", "isbn", "translators", "publisher", "tags", "description",
             "page_count", "publication_year", "edition", "sample_file", "file_size"},
        )
        self.assertEqual(data["translators"], ["مترجم"])
        self.assertEqual(data["tags"], ["فلسفه"])
        self.assertEqual(data["publisher"], "نشر نمونه")
        self.assertTrue(data["sample_file"].startswith("http://testserver/media/books/samples/"))
        self.assertEqual(data["file_size"], book.book_file.size)

    def test_empty_relations_and_files_are_null(self):
        book = self.make_book("بدون ناشر")
        book.cover = ""
        book.save()
        data = self.client.get(f"{self.list_url}{book.id}/").data
        self.assertIsNone(data["publisher"])
        self.assertIsNone(data["category"])
        self.assertIsNone(data["cover"])
        self.assertIsNone(data["sample_file"])
        self.assertEqual(data["translators"], [])

    def test_book_file_never_in_responses(self):
        book = self.make_book("کتاب پولی")
        for url in (self.list_url, f"{self.list_url}{book.id}/"):
            body = self.client.get(url).content.decode()
            # نه کلید، نه آدرس پوشه‌ی فایل‌های کامل
            self.assertNotIn("book_file", body)
            self.assertNotIn("books/files/", body)

    # --- ترتیب، جست‌وجو، فیلتر، صفحه‌بندی ---

    def test_newest_first(self):
        self.make_book("قدیمی")
        self.make_book("جدید")
        self.assertEqual(self.titles(self.client.get(self.list_url)), ["جدید", "قدیمی"])

    def test_search_by_title_isbn_and_author(self):
        target = self.make_book("Brief History", authors=("Stephen Hawking",))
        self.make_book("دیگری", authors=("کسی دیگر",))
        for term in ("brief", target.isbn, "hawking"):
            res = self.client.get(self.list_url, {"search": term})
            self.assertEqual(self.titles(res), ["Brief History"], term)

    def test_search_persian_title_and_author(self):
        self.make_book("صد سال تنهایی", authors=("گابریل گارسیا مارکز",))
        self.make_book("دیگری", authors=("کسی دیگر",))
        for term in ("تنهایی", "مارکز"):
            res = self.client.get(self.list_url, {"search": term})
            self.assertEqual(self.titles(res), ["صد سال تنهایی"], term)

    def test_search_matching_two_authors_does_not_duplicate(self):
        self.make_book("دونفره", authors=("Ali Rezaei", "Ali Karimi"))
        res = self.client.get(self.list_url, {"search": "Ali"})
        self.assertEqual(self.titles(res), ["دونفره"])

    def test_filter_by_category(self):
        self.make_book("علمی", category=self.science)
        self.make_book("رمان", category=self.novel)
        res = self.client.get(self.list_url, {"category": self.science.id})
        self.assertEqual(self.titles(res), ["علمی"])

    def test_invalid_category_filter(self):
        res = self.client.get(self.list_url, {"category": "abc"})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("category", res.data)

    def test_paginated_20_per_page(self):
        for i in range(25):
            self.make_book(f"کتاب {i}")
        page1 = self.client.get(self.list_url)
        self.assertEqual(page1.data["count"], 25)
        self.assertEqual(len(page1.data["results"]), 20)
        self.assertIsNotNone(page1.data["next"])
        page2 = self.client.get(self.list_url, {"page": 2})
        self.assertEqual(len(page2.data["results"]), 5)
        self.assertIsNone(page2.data["next"])

    # --- N+1 ---

    def count_list_queries(self):
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_200_OK)
        return len(ctx.captured_queries)

    def test_list_query_count_does_not_grow_with_books(self):
        for i in range(3):
            self.make_book(f"الف {i}", authors=(f"n{i}", f"m{i}"), category=self.science)
        few = self.count_list_queries()
        for i in range(10):
            self.make_book(f"ب {i}", authors=(f"x{i}", f"y{i}"), category=self.novel)
        many = self.count_list_queries()
        # count + کتاب‌ها (با JOIN دسته‌بندی) + نویسنده‌ها، مستقل از تعداد کتاب‌ها
        self.assertEqual(few, many)
        self.assertEqual(many, 3)

    def test_detail_query_count(self):
        book = self.make_book("کتاب", category=self.science, publisher=Publisher.objects.create(name="ن"))
        with CaptureQueriesContext(connection) as ctx:
            self.client.get(f"{self.list_url}{book.id}/")
        # کتاب (با JOIN دسته‌بندی و ناشر) + نویسنده‌ها + مترجم‌ها + برچسب‌ها
        self.assertEqual(len(ctx.captured_queries), 4)

    # --- ساخت هنوز فقط برای کاربر واردشده ---

    def test_post_still_requires_login(self):
        res = self.client.post(self.list_url, {}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


# ---------------------------------------------------------------------------
# شابک و جست‌وجو در Open Library
# ---------------------------------------------------------------------------

class NormalizeIsbnTests(APITestCase):
    def test_accepts_isbn13_with_hyphens_and_persian_digits(self):
        self.assertEqual(normalize_isbn("978-964-311-344-5"), "9789643113445")
        self.assertEqual(normalize_isbn("۹۷۸۹۶۴۳۱۱۳۴۴۵"), "9789643113445")
        self.assertEqual(normalize_isbn(" ۹۷۸-۹۶۴-۳۱۱-۳۴۴-۵ "), "9789643113445")

    def test_converts_isbn10_to_13(self):
        # 964-311-344-2 شکل ده‌رقمی همان سمفونی مردگان است
        self.assertEqual(normalize_isbn("964-311-344-2"), "9789643113445")
        # رقم کنترلی X (یعنی ۱۰) در ISBN-10
        self.assertEqual(normalize_isbn("0-8044-2957-X"), "9780804429573")
        self.assertEqual(normalize_isbn("080442957x"), "9780804429573")

    def test_rejects_invalid(self):
        cases = {
            "": ISBN_EMPTY,
            "12345": ISBN_FORMAT,
            "97896431134ab": ISBN_FORMAT,
            "9789643113446": ISBN_CHECKSUM,  # رقم کنترلی غلط
            "9643113441": ISBN_CHECKSUM,
        }
        for raw, message in cases.items():
            with self.assertRaises(InvalidISBN, msg=raw) as ctx:
                normalize_isbn(raw)
            self.assertEqual(str(ctx.exception), message, raw)


# نمونه‌ی واقعی جواب Open Library برای 9789643113445 (کوتاه‌شده)
OPEN_LIBRARY_HIT = {
    "ISBN:9789643113445": {
        "title": "سمفونی مردگان",
        "authors": [{"name": "عباس معروفی", "url": "https://openlibrary.org/authors/OL1A"}],
        "number_of_pages": 352,
        "publishers": [{"name": "ققنوس"}, {"name": "ناشر دوم"}],
        "publish_date": "1989",
        "subjects": [{"name": "Persian fiction"}, {"name": "Fiction"}],
        "cover": {
            "small": "https://covers.openlibrary.org/b/id/1-S.jpg",
            "medium": "https://covers.openlibrary.org/b/id/1-M.jpg",
            "large": "https://covers.openlibrary.org/b/id/1-L.jpg",
        },
    }
}


def fake_response(json_data=None, status_code=200, json_error=None):
    """یک شیء شبیه requests.Response؛ فقط چیزهایی که کد ما از آن استفاده می‌کند."""
    response = mock.Mock(status_code=status_code)
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(f"{status_code} error")
    if json_error:
        response.json.side_effect = json_error
    else:
        response.json.return_value = json_data
    return response


# requests.get را دقیقاً همان‌جایی عوض می‌کنیم که کد ما صدایش می‌زند (داخل ماژول openlibrary).
# در طول تست، هر صدا زدن requests.get به این mock می‌رسد و هیچ درخواستی به شبکه نمی‌رود.
PATCH_TARGET = "catalog.book_sources.openlibrary.requests.get"


@override_settings(MEDIA_ROOT=READ_MEDIA)
class IsbnLookupTests(APITestCase):
    url = "/catalog/isbn-lookup/"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="lookup", email="l@example.com", password="Str0ng-Passw0rd!"
        )
        self.client.force_authenticate(self.user)

    def lookup(self, isbn):
        return self.client.get(self.url, {"isbn": isbn})

    @mock.patch(PATCH_TARGET)
    def test_successful_lookup(self, fake_get):
        fake_get.return_value = fake_response(OPEN_LIBRARY_HIT)
        res = self.lookup("978-964-311-344-5")

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data, {
            "isbn": "9789643113445",
            "title": "سمفونی مردگان",
            "authors": ["عباس معروفی"],
            "publisher": "ققنوس",
            "page_count": 352,
            "publication_year": 1989,
            "cover_url": "https://covers.openlibrary.org/b/id/1-L.jpg",
            "subjects": ["Persian fiction", "Fiction"],
            "already_exists": False,
        })
        # درخواست بیرونی حتماً timeout دارد و هر دو شکل شابک را می‌پرسد
        _, kwargs = fake_get.call_args
        self.assertEqual(kwargs["timeout"], 5)
        self.assertEqual(kwargs["params"]["bibkeys"], "ISBN:9789643113445,ISBN:9643113442")

    @mock.patch(PATCH_TARGET)
    def test_found_under_isbn10_key(self, fake_get):
        entry = OPEN_LIBRARY_HIT["ISBN:9789643113445"]
        fake_get.return_value = fake_response({"ISBN:9643113442": entry})
        res = self.lookup("9789643113445")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["title"], "سمفونی مردگان")

    @mock.patch(PATCH_TARGET)
    def test_missing_values_are_null_or_empty(self, fake_get):
        fake_get.return_value = fake_response({"ISBN:9789643113445": {"publish_date": "May 1368 [1989]"}})
        res = self.lookup("9789643113445")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone(res.data["title"])
        self.assertEqual(res.data["authors"], [])
        self.assertIsNone(res.data["publisher"])
        self.assertIsNone(res.data["page_count"])
        self.assertIsNone(res.data["cover_url"])
        self.assertEqual(res.data["subjects"], [])
        # اولین عدد چهاررقمی، هر قالبی که تاریخ داشته باشد
        self.assertEqual(res.data["publication_year"], 1368)

    @mock.patch(PATCH_TARGET)
    def test_already_exists(self, fake_get):
        fake_get.return_value = fake_response(OPEN_LIBRARY_HIT)
        Book.objects.create(
            title="x", isbn="9789643113445", price=0, status=Book.Status.REJECTED,
            uploaded_by=self.user, book_file=pdf_file(),
        )
        self.assertTrue(self.lookup("9789643113445").data["already_exists"])

    @mock.patch(PATCH_TARGET)
    def test_unknown_isbn_is_404(self, fake_get):
        fake_get.return_value = fake_response({})  # جواب واقعی Open Library برای شابک ناشناخته
        res = self.lookup("9780306406157")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("دستی وارد کنید", res.data["detail"])
        self.assertEqual(res.data["isbn"], "9780306406157")
        self.assertFalse(res.data["already_exists"])

    @mock.patch(PATCH_TARGET)
    def test_invalid_isbn_is_400_without_calling_open_library(self, fake_get):
        res = self.lookup("9789643113446")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data, {"isbn": [ISBN_CHECKSUM]})
        fake_get.assert_not_called()

    @mock.patch(PATCH_TARGET, side_effect=requests.Timeout("read timed out"))
    def test_timeout_is_502(self, fake_get):
        res = self.lookup("9789643113445")
        self.assertEqual(res.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertIn("دستی وارد کنید", res.data["detail"])
        fake_get.assert_called_once()

    @mock.patch(PATCH_TARGET, side_effect=requests.ConnectionError("no route to host"))
    def test_unreachable_is_502(self, fake_get):
        self.assertEqual(self.lookup("9789643113445").status_code, status.HTTP_502_BAD_GATEWAY)

    @mock.patch(PATCH_TARGET)
    def test_server_error_or_bad_body_is_502(self, fake_get):
        responses = [
            fake_response(status_code=503),
            fake_response(json_error=requests.JSONDecodeError("bad", "<html>", 0)),
            fake_response(["not", "a", "dict"]),
            fake_response({"ISBN:9789643113445": "not a dict"}),
        ]
        for response in responses:
            fake_get.return_value = response
            self.assertEqual(self.lookup("9789643113445").status_code, status.HTTP_502_BAD_GATEWAY)

    @mock.patch(PATCH_TARGET)
    def test_requires_login(self, fake_get):
        self.client.force_authenticate(None)
        self.assertEqual(self.lookup("9789643113445").status_code, status.HTTP_401_UNAUTHORIZED)
        fake_get.assert_not_called()
