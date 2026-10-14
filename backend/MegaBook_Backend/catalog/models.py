from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models

pdf_only = FileExtensionValidator(allowed_extensions=["pdf"])

# پیام‌های «این شابک در مگابوک هست»، مشترک بین ساخت کتاب، جستجوی شابک و ثبت درخواست
BOOK_EXISTS_APPROVED = "کتابی با این شابک قبلاً ثبت شده است."
BOOK_EXISTS_PENDING = "این کتاب بارگذاری شده و در انتظار بررسی است."


class Person(models.Model):
    # نویسنده یا مترجم. یک جدول برای هر دو، چون یک نفر می‌تواند هر دو نقش را داشته باشد.
    name = models.CharField(max_length=200, unique=True)

    def __str__(self):
        return self.name


class Publisher(models.Model):
    name = models.CharField(max_length=200, unique=True)

    def __str__(self):
        return self.name


class Category(models.Model):
    # موضوع کتاب؛ همان تب‌های صفحه اصلی (داستان و رمان، سبک زندگی، ...)
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Tag(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name


class Book(models.Model):
    class Status(models.TextChoices):
        # مقدار اول در دیتابیس ذخیره می‌شود، مقدار دوم برای نمایش است
        PENDING = "pending", "در انتظار تایید"
        APPROVED = "approved", "تایید شده"
        REJECTED = "rejected", "رد شده"

    # --- هویت کتاب ---
    title = models.CharField(max_length=300)
    original_title = models.CharField(max_length=300, blank=True)
    # سیزده رقم، بدون خط تیره. یکتا فقط بین کتاب‌های «رد نشده» (قید پایین در Meta):
    # کتاب رد شده (مثلاً به خاطر قیمت یا فایل نامناسب) دوباره قابل بارگذاری است و
    # ردیف رد شده به‌عنوان سابقه می‌ماند. db_index برای جستجوی سریع با شابک.
    isbn = models.CharField(max_length=13, db_index=True)

    # --- افراد و نشر ---
    authors = models.ManyToManyField(Person, related_name="authored_books")
    translators = models.ManyToManyField(
        Person, related_name="translated_books", blank=True
    )
    # ناشرِ همین نسخه (برای کتاب ترجمه‌شده: ناشر ترجمه)
    publisher = models.ForeignKey(
        Publisher,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="books",
    )
    
    # --- دسته‌بندی ---
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="books",
    )
    tags = models.ManyToManyField(Tag, related_name="books", blank=True)

    # --- جزئیات ---
    description = models.TextField(blank=True)
    language = models.CharField(max_length=10, default="fa")
    page_count = models.PositiveIntegerField(null=True, blank=True)
    publication_year = models.PositiveSmallIntegerField(null=True, blank=True)
    edition = models.CharField(max_length=50, blank=True)

    # --- فایل‌ها ---
    cover = models.ImageField(upload_to="books/covers/", blank=True)
    sample_file = models.FileField(
        upload_to="books/samples/", blank=True, validators=[pdf_only]
    )
    book_file = models.FileField(upload_to="books/files/", validators=[pdf_only])

    # --- فروش ---
    # به تومان؛ صفر یعنی رایگان
    price = models.PositiveIntegerField()

    # --- گردش کار ---
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="uploaded_books",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # برای هر شابک حداکثر یک کتاب «در انتظار تایید» یا «تایید شده»؛ تعداد کتاب‌های رد شده آزاد است.
            # در PostgreSQL یک unique index جزئی (partial) می‌شود.
            models.UniqueConstraint(
                fields=["isbn"],
                condition=~models.Q(status="rejected"),
                name="unique_isbn_unless_rejected",
                violation_error_message="کتاب دیگری با این شابک در مگابوک هست (تایید شده یا در انتظار بررسی).",
            ),
        ]

    def __str__(self):
        return self.title

    @classmethod
    def active_for_isbn(cls, isbn):
        """کتاب «رد نشده» (تایید شده یا در انتظار تایید) با این شابک، یا None.

        به خاطر قید unique_isbn_unless_rejected حداکثر یکی وجود دارد. کتاب رد شده حساب نمی‌شود،
        چون جلوی بارگذاری دوباره یا درخواست را نمی‌گیرد. ساخت کتاب، جستجوی شابک و ثبت درخواست
        همه از همین استفاده می‌کنند تا «این کتاب در مگابوک هست؟» همه‌جا یک معنا داشته باشد.
        """
        return cls.objects.exclude(status=cls.Status.REJECTED).filter(isbn=isbn).only("id", "status").first()

    @property
    def file_size(self):
        # حجم به بایت؛ از خود فایل خوانده می‌شود و ستونی در دیتابیس ندارد
        return self.book_file.size if self.book_file else None
