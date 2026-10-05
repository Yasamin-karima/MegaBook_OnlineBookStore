import io
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

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
