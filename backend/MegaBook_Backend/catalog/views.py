from django.http import Http404
from rest_framework import filters, generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from MegaBook_Backend import private_files

from .book_sources import SourceUnavailable, lookup_isbn
from .isbn import InvalidISBN, normalize_isbn
from .models import Book, Category
from .serializers import (
    BookCreateSerializer,
    BookDetailSerializer,
    BookListSerializer,
    CategorySerializer,
)


def approved_books():
    # تنها نقطه‌ای که «کتاب قابل نمایش» تعریف می‌شود؛ کتاب pending و rejected هیچ‌وقت برنمی‌گردد.
    # "-id" برای وقتی است که دو کتاب created_at یکسان دارند، تا ترتیب صفحه‌ها همیشه ثابت بماند.
    return Book.objects.filter(status=Book.Status.APPROVED).order_by("-created_at", "-id")


class BookPagination(PageNumberPagination):
    # فقط برای همین endpoint؛ پروژه تنظیم صفحه‌بندی سراسری ندارد.
    # صفحه با ?page=2 انتخاب می‌شود.
    page_size = 20


class BookListCreateView(generics.ListCreateAPIView):
    """
    GET  /catalog/books/  -> فهرست کتاب‌های تاییدشده (عمومی، صفحه‌بندی‌شده)
         ?search=<متن>     جست‌وجو در عنوان، شابک و نام نویسنده
         ?category=<id>    فقط کتاب‌های یک دسته‌بندی
         ?page=<n>         شماره‌ی صفحه
    POST /catalog/books/  -> کتاب جدید با وضعیت «در انتظار تایید» (فقط کاربر واردشده)
    """
    # خواندن برای همه آزاد است، نوشتن فقط برای کاربر واردشده
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    # فرم ساخت کتاب فایل دارد، پس POST به شکل multipart می‌آید (GET بدنه ندارد)
    parser_classes = [MultiPartParser, FormParser]
    pagination_class = BookPagination
    # SearchFilter خود DRF: ?search= را روی این فیلدها با icontains جست‌وجو می‌کند.
    # authors__name از رابطه‌ی چندبه‌چند رد می‌شود؛ DRF خودش ردیف تکراری را حذف می‌کند.
    filter_backends = [filters.SearchFilter]
    search_fields = ["title", "isbn", "authors__name"]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return BookCreateSerializer
        return BookListSerializer

    def get_queryset(self):
        # select_related: category با JOIN در همان query می‌آید (رابطه‌ی ForeignKey)
        # prefetch_related: نویسنده‌های همه‌ی کتاب‌های صفحه با یک query اضافه می‌آیند (چندبه‌چند)
        queryset = approved_books().select_related("category").prefetch_related("authors")

        category = self.request.query_params.get("category")
        if category:
            if not category.isdigit():
                raise ValidationError({"category": ["شناسه‌ی دسته‌بندی باید عدد باشد."]})
            queryset = queryset.filter(category_id=int(category))
        return queryset

    def perform_create(self, serializer):
        # بارگذارنده همیشه کاربر واردشده است، نه چیزی که کلاینت بفرستد
        serializer.save(uploaded_by=self.request.user)


class BookDetailView(generics.RetrieveAPIView):
    """GET /catalog/books/<id>/ -> جزئیات یک کتاب تاییدشده (عمومی). کتاب تاییدنشده: 404."""
    serializer_class = BookDetailSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        return (
            approved_books()
            .select_related("category", "publisher")
            .prefetch_related("authors", "translators", "tags")
        )


LOOKUP_NOT_FOUND = "اطلاعات این شابک در Open Library پیدا نشد. لطفاً مشخصات کتاب را دستی وارد کنید."
LOOKUP_UNAVAILABLE = (
    "دریافت اطلاعات از Open Library ممکن نشد (پاسخ نداد یا پاسخ نامعتبر داد). "
    "لطفاً مشخصات کتاب را دستی وارد کنید."
)


class IsbnLookupView(APIView):
    """
    GET /catalog/isbn-lookup/?isbn=<شابک>  (فقط کاربر واردشده)
    اطلاعات کتاب را از منبع بیرونی می‌گیرد تا فرم بارگذاری پیش‌پر شود. چیزی ذخیره نمی‌شود.

    200: پیدا شد        400: شابک نامعتبر (مشکل از ورودی کاربر)
    404: پیدا نشد       502: منبع بیرونی در دسترس نیست (مشکل از سرویس دیگر، نه ما و نه کاربر)
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            isbn = normalize_isbn(request.query_params.get("isbn", ""))
        except InvalidISBN as error:
            # همان شکل خطای فرم ساخت کتاب، تا فرم پیام را زیر فیلد شابک نشان دهد
            return Response({"isbn": [str(error)]}, status=status.HTTP_400_BAD_REQUEST)

        # وضعیت این شابک در مگابوک؛ در هر سه جواب (200، 404، 502) برمی‌گردد:
        #   already_exists   کتاب «رد نشده» هست، پس نمی‌شود دوباره بارگذاری‌اش کرد
        #   existing_status  "approved" | "pending" | null؛ کتاب رد شده null حساب می‌شود
        #                    چون جلوی بارگذاری دوباره یا درخواست را نمی‌گیرد
        #   book_id          فقط برای کتاب تایید شده (برای لینک به صفحه‌ی کتاب)؛ وگرنه null
        existing = Book.active_for_isbn(isbn)
        in_megabook = {
            "already_exists": existing is not None,
            "existing_status": existing.status if existing else None,
            "book_id": existing.id if existing and existing.status == Book.Status.APPROVED else None,
        }

        try:
            metadata = lookup_isbn(isbn)
        except SourceUnavailable:
            return Response(
                {"detail": LOOKUP_UNAVAILABLE, "isbn": isbn, **in_megabook},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if metadata is None:
            return Response(
                {"detail": LOOKUP_NOT_FOUND, "isbn": isbn, **in_megabook},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"isbn": isbn, **metadata, **in_megabook})


class CategoryListView(generics.ListAPIView):
    """GET -> فهرست دسته‌بندی‌ها [{id, name}] برای منوی «موضوع» فرم."""
    queryset = Category.objects.order_by("name")
    serializer_class = CategorySerializer
    permission_classes = [permissions.AllowAny]
    # توکن (حتی منقضی) نادیده گرفته شود؛ این فهرست عمومی است
    authentication_classes = []


# --- The full book file (private; DECISIONS 3.8 and 3.15) ---

BOOK_FILE = "book-file"  # the signing salt's name; a receipt token can't open a book


class BookFileLinkView(APIView):
    """GET /catalog/books/<id>/file-link/ (logged in) -> { url, expires_in }

    A signed download link for the full file, valid for a few minutes, for a user
    allowed to download it (Book.can_download_file). Anyone else gets 404, the same
    as a book that doesn't exist, so the response doesn't reveal which books exist.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        book = Book.objects.filter(pk=pk).first()
        if book is None or not book.can_download_file(request.user):
            return Response({"detail": "پیدا نشد."}, status=status.HTTP_404_NOT_FOUND)
        return Response(private_files.make_link(request, BOOK_FILE, "book_file", book.pk, request.user))


def book_file_view(request, pk):
    """GET /catalog/books/<id>/file/?t=<signed token> -> the PDF.

    A plain Django view (not DRF): the browser opens it with a plain link, which
    can't carry the JWT header. Permission is checked again here, because the user
    may have lost access since the link was made. Staff logged in to the admin
    (session cookie) need no token.
    """
    book = Book.objects.filter(pk=pk).first()
    user = private_files.download_user(request, BOOK_FILE, pk)
    if book is None or not book.can_download_file(user):
        raise Http404
    return private_files.file_response(book.book_file, book.title)
