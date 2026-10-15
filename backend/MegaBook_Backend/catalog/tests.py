import io
import shutil
import tempfile
from pathlib import Path
from unittest import mock

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from .book_sources import CoverDownloadError, download_cover
from .isbn import ISBN_EMPTY, ISBN_FORMAT, InvalidISBN, normalize_isbn
from .models import APPROVED_NEEDS_PRICE, PRICE_BELOW_SELLER_SHARE, Book, Category, Person, Publisher, Tag
from .serializers import ISBN_CHECKSUM, ISBN_IN_REVIEW, ISBN_LENGTH, ISBN_TAKEN

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
            first_name="sara", last_name="Test", email="sara@example.com", password="Str0ng-Passw0rd!"
        )
        self.category = Category.objects.create(name="داستان و رمان")
        self.client.force_authenticate(self.user)

    def payload(self, **overrides):
        # همان کلیدهایی که buildFormData در فرانت می‌سازد
        data = {
            "title": "کتابخانه نیمه‌شب",
            "isbn": VALID_ISBN,
            "language": "en",
            "seller_share": "120000",
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
            "title": "حداقل", "isbn": VALID_ISBN, "language": "fa", "seller_share": "0",
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
        other = get_user_model().objects.create_user(first_name="x", last_name="Test", email="x@example.com", password="Str0ng-Passw0rd!")
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

    def test_isbn_of_pending_book_is_refused_with_in_review_message(self):
        self.post()  # کتاب اول در انتظار تایید است
        res = self.post(cover=png_file(), book_file=pdf_file())
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["isbn"], [ISBN_IN_REVIEW])
        self.assertEqual(Book.objects.count(), 1)

    def test_isbn_of_approved_book_is_refused(self):
        self.post()
        Book.objects.update(status=Book.Status.APPROVED, price=150000)
        res = self.post(cover=png_file(), book_file=pdf_file())
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["isbn"], [ISBN_TAKEN])
        self.assertEqual(Book.objects.count(), 1)

    def test_rejected_book_can_be_uploaded_again(self):
        self.post()
        Book.objects.update(status=Book.Status.REJECTED)
        res = self.post(cover=png_file(), book_file=pdf_file(), seller_share="90000")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        # ردیف رد شده به‌عنوان سابقه می‌ماند؛ نسخه‌ی جدید در انتظار تایید است
        self.assertEqual(
            sorted(Book.objects.filter(isbn=VALID_ISBN).values_list("status", flat=True)),
            ["pending", "rejected"],
        )

    def test_missing_required_fields_give_persian_errors(self):
        res = self.client.post(self.url, {}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        for field in ["title", "isbn", "language", "seller_share", "authors", "cover", "book_file"]:
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
            first_name="uploader", last_name="Test", email="u@example.com", password="Str0ng-Passw0rd!"
        )
        self.science = Category.objects.create(name="علمی")
        self.novel = Category.objects.create(name="داستان و رمان")
        self.counter = 0

    def make_book(self, title, status=Book.Status.APPROVED, authors=("نویسنده",), category=None, price=1000, **extra):
        # کتاب را مستقیم در دیتابیس می‌سازیم (نه از API) تا وضعیت را آزادانه تعیین کنیم
        self.counter += 1
        book = Book.objects.create(
            title=title,
            isbn=f"978000000{self.counter:04d}",
            price=price,
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

    def test_private_money_and_file_never_public(self):
        # seller_share would reveal MegaBook's commission; book_file is the paid content
        book = self.make_book("کتاب", price=5000, seller_share=3500)
        item = self.client.get(self.list_url).data["results"][0]
        detail = self.client.get(f"{self.list_url}{book.id}/").data
        for data in (item, detail):
            self.assertNotIn("seller_share", data)
            self.assertNotIn("commission", data)
            self.assertNotIn("book_file", data)
            self.assertEqual(data["price"], 5000)

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
            first_name="lookup", last_name="Test", email="l@example.com", password="Str0ng-Passw0rd!"
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
            "existing_status": None,
            "book_id": None,
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

    def make_existing(self, book_status):
        return Book.objects.create(
            title="x", isbn="9789643113445", price=0, status=book_status,
            uploaded_by=self.user, book_file="books/files/x.pdf",
        )

    @mock.patch(PATCH_TARGET)
    def test_existing_approved_book(self, fake_get):
        fake_get.return_value = fake_response(OPEN_LIBRARY_HIT)
        book = self.make_existing(Book.Status.APPROVED)
        data = self.lookup("9789643113445").data
        self.assertTrue(data["already_exists"])
        self.assertEqual(data["existing_status"], "approved")
        self.assertEqual(data["book_id"], book.id)

    @mock.patch(PATCH_TARGET)
    def test_existing_pending_book_has_no_book_id(self, fake_get):
        fake_get.return_value = fake_response(OPEN_LIBRARY_HIT)
        self.make_existing(Book.Status.PENDING)
        data = self.lookup("9789643113445").data
        self.assertTrue(data["already_exists"])
        self.assertEqual(data["existing_status"], "pending")
        # صفحه‌ی کتاب در انتظار عمومی نیست، پس لینکی هم نیست
        self.assertIsNone(data["book_id"])

    @mock.patch(PATCH_TARGET)
    def test_rejected_book_does_not_count_as_existing(self, fake_get):
        fake_get.return_value = fake_response(OPEN_LIBRARY_HIT)
        self.make_existing(Book.Status.REJECTED)
        data = self.lookup("9789643113445").data
        self.assertFalse(data["already_exists"])
        self.assertIsNone(data["existing_status"])

    @mock.patch(PATCH_TARGET)
    def test_existing_status_also_on_404(self, fake_get):
        fake_get.return_value = fake_response({})
        self.make_existing(Book.Status.PENDING)
        res = self.lookup("9789643113445")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(res.data["existing_status"], "pending")

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


# ---------------------------------------------------------------------------
# دانلود جلد از Open Library (شبکه mock است؛ هیچ تستی چیزی دانلود نمی‌کند)
# ---------------------------------------------------------------------------

COVER_URL = "https://covers.openlibrary.org/b/id/14412247-L.jpg"
ARCHIVE_URL = "https://ia800507.us.archive.org/view_archive.php?archive=/x/14412247-L.jpg"


def image_bytes(fmt="JPEG"):
    buffer = io.BytesIO()
    Image.new("RGB", (20, 30), "red").save(buffer, format=fmt)
    return buffer.getvalue()


class FakeStreamResponse:
    """شبیه requests.Response با stream=True؛ فقط چیزهایی که download_cover استفاده می‌کند."""

    def __init__(self, status_code=200, body=b"", headers=None, chunks=None):
        self.status_code = status_code
        self.headers = headers or {}
        self._body = body
        self._chunks = chunks  # اگر داده شود، به‌جای body تکه‌ها را از این generator می‌دهد
        self.chunks_read = 0
        self.closed = False

    def iter_content(self, chunk_size):
        source = self._chunks or (self._body[i:i + chunk_size] for i in range(0, len(self._body), chunk_size))
        for chunk in source:
            self.chunks_read += 1
            yield chunk

    def close(self):
        self.closed = True


def redirect(location):
    return FakeStreamResponse(status_code=302, headers={"Location": location})


@mock.patch(PATCH_TARGET)
class DownloadCoverTests(TestCase):
    def test_success_returns_saveable_file_named_by_isbn(self, fake_get):
        data = image_bytes("JPEG")
        fake_get.return_value = FakeStreamResponse(body=data, headers={"Content-Length": str(len(data))})
        cover = download_cover(COVER_URL, "9789643113445")
        self.assertEqual(cover.name, "9789643113445.jpg")
        self.assertEqual(cover.read(), data)
        # redirect خودکار خاموش، stream روشن، timeout دارد
        _, kwargs = fake_get.call_args
        self.assertFalse(kwargs["allow_redirects"])
        self.assertTrue(kwargs["stream"])
        self.assertLessEqual(kwargs["timeout"], 10)

    def test_png_gets_png_extension(self, fake_get):
        fake_get.return_value = FakeStreamResponse(body=image_bytes("PNG"))
        self.assertEqual(download_cover(COVER_URL, "9789643113445").name, "9789643113445.png")

    def test_redirect_to_archive_org_is_followed(self, fake_get):
        fake_get.side_effect = [redirect(ARCHIVE_URL), FakeStreamResponse(body=image_bytes())]
        download_cover(COVER_URL, "9789643113445")
        self.assertEqual([c.args[0] for c in fake_get.call_args_list], [COVER_URL, ARCHIVE_URL])

    def test_relative_redirect_is_resolved_and_checked(self, fake_get):
        fake_get.side_effect = [redirect("/b/id/1-M.jpg"), FakeStreamResponse(body=image_bytes())]
        download_cover(COVER_URL, "9789643113445")
        self.assertEqual(fake_get.call_args_list[1].args[0], "https://covers.openlibrary.org/b/id/1-M.jpg")

    def test_redirect_outside_allowlist_is_refused_before_request(self, fake_get):
        for bad in ("https://evil.example.com/x.jpg", "http://ia800507.us.archive.org/x.jpg",
                    "https://169.254.169.254/latest/meta-data/", "https://evilarchive.org/x.jpg",
                    "https://archive.org.evil.com/x.jpg"):
            fake_get.reset_mock()
            fake_get.side_effect = [redirect(bad)]
            with self.assertRaises(CoverDownloadError, msg=bad):
                download_cover(COVER_URL, "9789643113445")
            # آدرس غیرمجاز هرگز درخواست نشد
            self.assertEqual(fake_get.call_count, 1, bad)

    def test_first_url_must_be_covers_openlibrary_over_https(self, fake_get):
        for bad in ("https://evil.example.com/x.jpg", "http://covers.openlibrary.org/b/id/1-L.jpg",
                    "https://ia800507.us.archive.org/x.jpg",  # مجاز برای redirect، نه برای شروع
                    "https://covers.openlibrary.org@evil.com/x.jpg",
                    "https://covers.openlibrary.org:8080/x.jpg", "file:///etc/passwd"):
            with self.assertRaises(CoverDownloadError, msg=bad):
                download_cover(bad, "9789643113445")
        fake_get.assert_not_called()

    def test_too_many_redirects(self, fake_get):
        fake_get.side_effect = [redirect(COVER_URL) for _ in range(6)]
        with self.assertRaises(CoverDownloadError):
            download_cover(COVER_URL, "9789643113445")
        self.assertEqual(fake_get.call_count, 6)  # آدرس اصلی + ۵ redirect، بعد توقف

    def test_timeout(self, fake_get):
        fake_get.side_effect = requests.Timeout("read timed out")
        with self.assertRaises(CoverDownloadError):
            download_cover(COVER_URL, "9789643113445")

    def test_too_large_by_content_length_is_refused_without_reading(self, fake_get):
        response = FakeStreamResponse(body=b"x" * 10, headers={"Content-Length": str(6 * 1024 * 1024)})
        fake_get.return_value = response
        with self.assertRaises(CoverDownloadError):
            download_cover(COVER_URL, "9789643113445")
        self.assertEqual(response.chunks_read, 0)
        self.assertTrue(response.closed)

    def test_too_large_while_streaming_stops_early(self, fake_get):
        # سروری که Content-Length نمی‌دهد و بی‌پایان داده می‌فرستد (سقف ایمنی تست: ۲۰۰ تکه)
        endless = (b"x" * 64 * 1024 for _ in range(200))
        response = FakeStreamResponse(chunks=endless)
        fake_get.return_value = response
        with self.assertRaises(CoverDownloadError):
            download_cover(COVER_URL, "9789643113445")
        # کمی بیش از ۵ مگابایت خوانده شد (۸۱ تکه‌ی ۶۴ کیلوبایتی)، نه کل ۱۲٫۵ مگابایت
        self.assertEqual(response.chunks_read, 81)

    def test_bytes_that_are_not_an_image(self, fake_get):
        for body in (b"<html>not an image</html>", image_bytes("GIF")):
            fake_get.return_value = FakeStreamResponse(body=body, headers={"Content-Type": "image/jpeg"})
            with self.assertRaises(CoverDownloadError):
                download_cover(COVER_URL, "9789643113445")

    def test_non_200_status(self, fake_get):
        fake_get.return_value = FakeStreamResponse(status_code=404)
        with self.assertRaises(CoverDownloadError):
            download_cover(COVER_URL, "9789643113445")


@override_settings(MEDIA_ROOT=READ_MEDIA)
class BookCreateCoverUrlTests(APITestCase):
    url = "/catalog/books/"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            first_name="cov", last_name="Test", email="cov@example.com", password="Str0ng-Passw0rd!"
        )
        self.client.force_authenticate(self.user)

    def post(self, **extra):
        data = {
            "title": "سمفونی مردگان", "isbn": "9789643113445", "language": "fa", "seller_share": "1000",
            "authors": ["عباس معروفی"], "book_file": pdf_file(), **extra,
        }
        return self.client.post(self.url, data, format="multipart")

    @mock.patch(PATCH_TARGET)
    def test_cover_url_is_downloaded_and_saved(self, fake_get):
        fake_get.return_value = FakeStreamResponse(body=image_bytes("JPEG"))
        res = self.post(cover_url=COVER_URL)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        book = Book.objects.get()
        self.assertTrue(book.cover.name.startswith("books/covers/9789643113445"))
        self.assertTrue(book.cover.name.endswith(".jpg"))
        self.assertNotIn("cover_url", res.data)

    @mock.patch(PATCH_TARGET)
    def test_uploaded_file_wins_and_nothing_is_downloaded(self, fake_get):
        res = self.post(cover=png_file(), cover_url=COVER_URL)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        fake_get.assert_not_called()
        self.assertTrue(Book.objects.get().cover.name.endswith(".png"))

    @mock.patch(PATCH_TARGET)
    def test_neither_cover_nor_url(self, fake_get):
        res = self.post()
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["cover"], ["تصویر جلد را انتخاب کنید."])
        fake_get.assert_not_called()

    @mock.patch(PATCH_TARGET)
    def test_failed_download_creates_nothing(self, fake_get):
        fake_get.side_effect = [redirect("https://evil.example.com/x.jpg")]
        res = self.post(cover_url=COVER_URL)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["cover"], ["جلد کتاب دریافت نشد؛ لطفاً تصویر را خودتان بارگذاری کنید"])
        self.assertEqual(Book.objects.count(), 0)
        self.assertEqual(Person.objects.count(), 0)

    @mock.patch(PATCH_TARGET)
    def test_url_on_other_host_is_refused_without_request(self, fake_get):
        res = self.post(cover_url="https://evil.example.com/cover.jpg")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["cover"], ["جلد کتاب دریافت نشد؛ لطفاً تصویر را خودتان بارگذاری کنید"])
        fake_get.assert_not_called()


class BookIsbnConstraintTests(TestCase):
    """قید unique_isbn_unless_rejected در خود دیتابیس، بدون کمک serializer."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            first_name="u", last_name="Test", email="u@example.com", password="Str0ng-Passw0rd!"
        )

    def book(self, book_status, **extra):
        return Book(
            title="x", isbn=VALID_ISBN, price=0, status=book_status,
            uploaded_by=self.user, book_file="books/files/x.pdf", **extra,
        )

    def test_two_active_books_with_same_isbn_are_refused(self):
        self.book(Book.Status.PENDING).save()
        for second in (Book.Status.PENDING, Book.Status.APPROVED):
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.book(second).save()

    def test_rejected_books_do_not_count(self):
        self.book(Book.Status.REJECTED).save()
        self.book(Book.Status.REJECTED).save()
        self.book(Book.Status.PENDING).save()  # نسخه‌ی تازه بعد از دو بار رد شدن
        self.assertEqual(Book.objects.filter(isbn=VALID_ISBN).count(), 3)

    def test_full_clean_reports_conflict_like_admin_form(self):
        # فرم ادمین full_clean را صدا می‌زند و جنگو قید شرطی را هم بررسی می‌کند؛
        # پس برگرداندن یک کتاب رد شده به «در انتظار» وقتی نسخه‌ی دیگری هست، خطای فرم می‌دهد نه 500
        self.book(Book.Status.PENDING).save()
        old = self.book(Book.Status.REJECTED)
        old.save()
        old.status = Book.Status.PENDING
        with self.assertRaises(ValidationError) as ctx:
            old.full_clean()
        self.assertIn("در مگابوک هست", str(ctx.exception))

    def test_active_for_isbn_ignores_rejected(self):
        self.book(Book.Status.REJECTED).save()
        self.assertIsNone(Book.active_for_isbn(VALID_ISBN))
        pending = self.book(Book.Status.PENDING)
        pending.save()
        self.assertEqual(Book.active_for_isbn(VALID_ISBN), pending)


class BookMoneyRuleTests(TestCase):
    """price / seller_share rules on the model itself: save(), clean() and the DB constraint."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            first_name="u", last_name="Test", email="u@example.com", password="Str0ng-Passw0rd!"
        )

    def book(self, book_status=Book.Status.PENDING, **extra):
        return Book(
            title="x", isbn=VALID_ISBN, status=book_status,
            uploaded_by=self.user, book_file="books/files/x.pdf", **extra,
        )

    def test_pending_book_may_have_no_price(self):
        book = self.book(seller_share=3000)
        book.save()
        book.refresh_from_db()
        self.assertIsNone(book.price)
        self.assertIsNone(book.commission)

    def test_approving_without_price_fails_on_save(self):
        book = self.book(seller_share=3000)
        book.save()
        book.status = Book.Status.APPROVED
        with self.assertRaises(ValidationError) as ctx:
            book.save()
        self.assertEqual(ctx.exception.message_dict["price"], [APPROVED_NEEDS_PRICE])
        book.refresh_from_db()
        self.assertEqual(book.status, Book.Status.PENDING)

    def test_approving_with_price_below_seller_share_fails(self):
        book = self.book(Book.Status.APPROVED, price=2000, seller_share=3000)
        with self.assertRaises(ValidationError) as ctx:
            book.save()
        self.assertEqual(ctx.exception.message_dict["price"], [PRICE_BELOW_SELLER_SHARE])
        self.assertFalse(Book.objects.exists())

    def test_clean_applies_the_same_rule(self):
        # clean() is what the admin form calls, so the error appears next to the price field
        book = self.book(Book.Status.APPROVED, seller_share=3000)
        with self.assertRaises(ValidationError) as ctx:
            book.clean()
        self.assertIn("price", ctx.exception.message_dict)

    def test_valid_approval(self):
        book = self.book(Book.Status.APPROVED, price=5000, seller_share=3500)
        book.save()
        self.assertEqual(book.commission, 1500)

    def test_price_equal_to_seller_share_is_valid(self):
        self.book(Book.Status.APPROVED, price=3000, seller_share=3000).save()
        self.assertEqual(Book.objects.get().commission, 0)

    def test_free_approved_book_is_valid(self):
        self.book(Book.Status.APPROVED, price=0, seller_share=0).save()
        self.assertEqual(Book.objects.get().price, 0)

    def test_lowering_price_of_approved_book_below_share_fails(self):
        book = self.book(Book.Status.APPROVED, price=5000, seller_share=3500)
        book.save()
        book.price = 1000
        with self.assertRaises(ValidationError):
            book.save()

    def test_database_constraint_catches_update_without_save(self):
        # QuerySet.update() skips save(); only the CheckConstraint stops these
        self.book(seller_share=3000).save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Book.objects.update(status=Book.Status.APPROVED)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Book.objects.update(status=Book.Status.APPROVED, price=1000)
        Book.objects.update(status=Book.Status.APPROVED, price=3000)
        self.assertEqual(Book.objects.get().status, Book.Status.APPROVED)


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class BookUploadMoneyTests(APITestCase):
    """The upload form's money field: seller_share for regular users, price for admins."""

    url = "/catalog/books/"

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            first_name="sara", last_name="Test", email="sara@example.com", password="Str0ng-Passw0rd!"
        )
        self.admin = get_user_model().objects.create_superuser(
            email="admin@example.com", first_name="a", last_name="b", password="Str0ng-Passw0rd!"
        )

    def post(self, user, **money):
        self.client.force_authenticate(user)
        data = {
            "title": "کتاب", "isbn": VALID_ISBN, "language": "fa", "authors": ["نویسنده"],
            "cover": png_file(), "book_file": pdf_file(), **money,
        }
        return self.client.post(self.url, data, format="multipart")

    def test_user_amount_is_stored_as_seller_share_and_price_stays_empty(self):
        res = self.post(self.user, seller_share="70000")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        book = Book.objects.get()
        self.assertEqual(book.seller_share, 70000)
        self.assertIsNone(book.price)
        self.assertEqual(book.status, Book.Status.PENDING)
        # The response goes only to the uploader, so their own share is in it
        self.assertEqual(res.data["seller_share"], 70000)
        self.assertIsNone(res.data["price"])

    def test_user_cannot_set_the_store_price(self):
        res = self.post(self.user, seller_share="70000", price="1")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertIsNone(Book.objects.get().price)

    def test_user_must_give_seller_share(self):
        res = self.post(self.user)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            res.data["seller_share"],
            ["مبلغی را که برای هر فروش می‌خواهید دریافت کنید وارد کنید. اگر پولی نمی‌خواهید، صفر بنویسید."],
        )
        self.assertNotIn("price", res.data)

    def test_negative_seller_share_rejected(self):
        res = self.post(self.user, seller_share="-5")
        self.assertEqual(res.data["seller_share"], ["مبلغ نمی‌تواند منفی باشد."])

    def test_admin_upload_sets_price_zero_share_and_is_approved(self):
        res = self.post(self.admin, price="90000", seller_share="50000")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        book = Book.objects.get()
        self.assertEqual((book.price, book.seller_share, book.status), (90000, 0, Book.Status.APPROVED))
        self.assertEqual(book.commission, 90000)
        # Approved right away, so it is in the public store
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).data["count"], 1)

    def test_admin_must_give_price(self):
        res = self.post(self.admin)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data["price"], ["قیمت فروش را وارد کنید. برای کتاب رایگان صفر بنویسید."])
        self.assertNotIn("seller_share", res.data)

    def test_admin_free_book(self):
        res = self.post(self.admin, price="0")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        book = Book.objects.get()
        self.assertEqual((book.price, book.seller_share), (0, 0))


class BookAdminMoneyTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser(
            email="admin@example.com", first_name="a", last_name="b", password="Str0ng-Passw0rd!"
        )
        self.client.force_login(self.admin)
        self.book = Book.objects.create(
            title="کتاب نمونه", isbn=VALID_ISBN, status=Book.Status.APPROVED, price=5000,
            seller_share=3500, uploaded_by=self.admin, book_file="books/files/x.pdf",
        )

    def test_list_page_shows_the_money_split(self):
        res = self.client.get("/admin/catalog/book/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "5,000 تومان")
        self.assertContains(res, "3,500 تومان")
        self.assertContains(res, "1,500 تومان")  # commission

    def test_change_page_has_editable_money_fields_and_commission(self):
        res = self.client.get(f"/admin/catalog/book/{self.book.pk}/change/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'name="price" value="5000"')
        self.assertContains(res, 'name="seller_share" value="3500"')
        self.assertContains(res, "1,500 تومان")  # read-only commission

    def test_add_page_opens(self):
        self.assertEqual(self.client.get("/admin/catalog/book/add/").status_code, 200)


class BookFilePrivacyTests(APITestCase):
    """The full book file: private storage, random name, signed short-lived links."""

    def setUp(self):
        self.uploader = get_user_model().objects.create_user(
            email="up@example.com", first_name="u", last_name="p", password="Str0ng-Passw0rd!"
        )
        self.other = get_user_model().objects.create_user(
            email="other@example.com", first_name="o", last_name="t", password="Str0ng-Passw0rd!"
        )
        self.admin = get_user_model().objects.create_superuser(
            email="admin@example.com", first_name="a", last_name="b", password="Str0ng-Passw0rd!"
        )
        self.book = Book.objects.create(
            title="کتاب خصوصی", isbn=VALID_ISBN, status=Book.Status.APPROVED, price=1000,
            uploaded_by=self.uploader, book_file=pdf_file(f"{VALID_ISBN}.pdf"),
        )

    def link(self, user):
        self.client.force_authenticate(user)
        return self.client.get(f"/catalog/books/{self.book.pk}/file-link/")

    def download(self, url):
        # A plain browser request: no JWT header
        self.client.force_authenticate(None)
        return self.client.get(url)

    def test_stored_outside_media_root_with_a_random_name(self):
        name = self.book.book_file.name
        self.assertTrue(name.startswith("books/files/"))
        self.assertNotIn(VALID_ISBN, name)  # the original name (an ISBN) is not kept
        path = Path(self.book.book_file.path).resolve()
        self.assertTrue(path.is_relative_to(Path(settings.PRIVATE_MEDIA_ROOT).resolve()))
        self.assertFalse(path.is_relative_to(Path(settings.MEDIA_ROOT).resolve()))
        with self.assertRaises(ValueError):
            self.book.book_file.url  # no public URL exists at all

    @override_settings(DEBUG=True)
    def test_media_url_does_not_reach_it(self):
        self.assertEqual(self.client.get(f"/media/{self.book.book_file.name}").status_code, 404)

    def test_uploader_gets_a_working_link(self):
        res = self.link(self.uploader)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["expires_in"], settings.PRIVATE_FILE_LINK_SECONDS)
        file_res = self.download(res.data["url"])
        self.assertEqual(file_res.status_code, 200)
        self.assertEqual(b"".join(file_res.streaming_content), b"%PDF-1.4\n%test\n")
        self.assertEqual(file_res["Content-Type"], "application/pdf")
        self.assertIn("private", file_res["Cache-Control"])

    def test_admin_gets_a_link(self):
        self.assertEqual(self.link(self.admin).status_code, 200)

    def test_other_users_and_anonymous_get_404(self):
        self.assertEqual(self.link(self.other).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/catalog/books/{self.book.pk}/file-link/").status_code, 401)
        self.assertEqual(self.client.get(f"/catalog/books/{self.book.pk}/file/").status_code, 404)

    def test_tampered_or_reused_token_rejected(self):
        url = self.link(self.uploader).data["url"]
        self.assertEqual(self.download(url + "x").status_code, 404)
        # The token names one book: it can't open another one
        other_book = Book.objects.create(
            title="x", isbn="9789643113445",
            status=Book.Status.PENDING, uploaded_by=self.uploader, book_file=pdf_file(),
        )
        token = url.split("?t=")[1]
        self.assertEqual(self.download(f"/catalog/books/{other_book.pk}/file/?t={token}").status_code, 404)

    def test_expired_link_rejected(self):
        url = self.link(self.uploader).data["url"]
        with override_settings(PRIVATE_FILE_LINK_SECONDS=-1):
            self.assertEqual(self.download(url).status_code, 404)

    def test_permission_checked_again_at_download(self):
        url = self.link(self.uploader).data["url"]
        self.uploader.is_active = False
        self.uploader.save()
        self.assertEqual(self.download(url).status_code, 404)

    def test_admin_session_needs_no_token(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get(f"/catalog/books/{self.book.pk}/file/").status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(f"/catalog/books/{self.book.pk}/file/").status_code, 404)

    def test_admin_change_page_links_through_the_view(self):
        self.client.force_login(self.admin)
        res = self.client.get(f"/admin/catalog/book/{self.book.pk}/change/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, f'href="/catalog/books/{self.book.pk}/file/"')
