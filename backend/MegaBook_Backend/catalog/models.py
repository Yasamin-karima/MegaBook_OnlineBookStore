from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models, transaction
from django.db.models import F, Q

from MegaBook_Backend.private_files import RandomName, private_storage

pdf_only = FileExtensionValidator(allowed_extensions=["pdf"])

# پیام‌های «این شابک در مگابوک هست»، مشترک بین ساخت کتاب، جستجوی شابک و ثبت درخواست
BOOK_EXISTS_APPROVED = "کتابی با این شابک قبلاً ثبت شده است."
BOOK_EXISTS_PENDING = "این کتاب بارگذاری شده و در انتظار بررسی است."

# Money rules for an approved book (Book.apply_money_rules)
APPROVED_NEEDS_PRICE = "برای تأیید کتاب، قیمت فروش را تعیین کنید."
PRICE_BELOW_SELLER_SHARE = "قیمت فروش نمی‌تواند کمتر از سهم بارگذارنده باشد."


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
    # The paid content: in private storage (outside MEDIA_ROOT, no URL) under a random
    # name, served only by BookFileView after a permission check (Book.can_download_file)
    book_file = models.FileField(
        upload_to=RandomName("books/files"), storage=private_storage, validators=[pdf_only]
    )

    # --- فروش ---
    # Two money values, both in toman. MegaBook's commission is NOT stored: it is
    # always price - seller_share (see the commission property and DECISIONS 3.6).
    # Store price buyers pay; 0 means free. NULL means "not set yet": allowed only
    # before approval, because the price is decided when the admin approves.
    price = models.PositiveIntegerField(null=True, blank=True)
    # What the uploader receives per sale. Private: never in a public API response,
    # or any buyer could compute the commission (like book_file, DECISIONS 3.8).
    # 0 for books uploaded by an admin (the whole price goes to MegaBook) and free books.
    seller_share = models.PositiveIntegerField(default=0)

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
            # The last layer of apply_money_rules, in the database itself: QuerySet.update()
            # (e.g. a bulk "approve" action) and raw SQL skip save(). An approved book
            # has a price, and the price covers the uploader's share.
            models.CheckConstraint(
                condition=~Q(status="approved") | (Q(price__isnull=False) & Q(price__gte=F("seller_share"))),
                name="approved_book_price_covers_seller_share",
                violation_error_message=PRICE_BELOW_SELLER_SHARE,
            ),
        ]

    def __str__(self):
        return self.title

    @property
    def commission(self):
        """MegaBook's share of each sale in toman, or None while the price isn't set.

        Derived, never stored, so it can't drift out of sync with the two numbers it
        comes from. When a sale happens, the commission is recorded as a real ledger
        entry in MegaBook's wallet (DECISIONS 6.1); this is only for display.
        """
        if self.price is None:
            return None
        return self.price - self.seller_share

    def apply_money_rules(self):
        """An approved book must have a price, and price >= seller_share.

        Called from both clean() and save(), like BookRequest.apply_status_rules
        (DECISIONS 5.5): Django calls clean() only from forms (including the admin),
        never on a plain save(). Pending and rejected books may have no price.
        """
        if self.status != self.Status.APPROVED:
            return
        if self.price is None:
            raise ValidationError({"price": APPROVED_NEEDS_PRICE})
        if self.price < self.seller_share:
            raise ValidationError({"price": PRICE_BELOW_SELLER_SHARE})

    def clean(self):
        # Here so the admin form shows the error next to the price field
        super().clean()
        self.apply_money_rules()

    def save(self, *args, **kwargs):
        # Here so the rule holds however the book is saved: admin, API, seed, shell
        self.apply_money_rules()
        adding = self._state.adding or self.pk is None
        previous = None
        if not adding:
            previous = type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
        with transaction.atomic():
            super().save(*args, **kwargs)
            # One path for "the status changed", whoever changes it (admin, API, shell).
            # Imported here: those apps depend on this one, not the other way round.
            if (adding and self.status == self.Status.APPROVED) or (previous is not None and previous != self.status):
                # The request for this ISBN follows the store: fulfilled when the book
                # goes on sale (also an admin's upload, created approved), open again
                # if it leaves (DECISIONS 5.14)
                from book_requests.services import sync_with_book

                sync_with_book(self, previous)
            if previous is not None and previous != self.status:
                # Approved or rejected: a system message in the upload's conversation (12.3)
                from support.services import on_book_status_changed

                on_book_status_changed(self, previous)
            self._notify(adding, previous)

    def _notify(self, adding, previous):
        """In-site notifications (DECISIONS 14), from the same place as the rest: whoever
        saves the book (admin form, API, shell) notifies the same way, and only when
        the status actually changed (editing an approved book's price notifies nobody)."""
        from notifications import services as notifications

        Type = notifications.Type
        if adding and self.status == self.Status.PENDING:
            # A user's upload waits for review (an admin's own upload is created approved)
            notifications.notify(Type.STAFF_NEW_UPLOAD, notifications.STAFF, book=self, params={"title": self.title})
        if previous is not None and previous != self.status:
            kind = {self.Status.APPROVED: Type.UPLOAD_APPROVED, self.Status.REJECTED: Type.UPLOAD_REJECTED}.get(self.status)
            if kind:
                notifications.notify(kind, [self.uploaded_by], book=self, params={"title": self.title})

    @classmethod
    def active_for_isbn(cls, isbn):
        """کتاب «رد نشده» (تایید شده یا در انتظار تایید) با این شابک، یا None.

        به خاطر قید unique_isbn_unless_rejected حداکثر یکی وجود دارد. کتاب رد شده حساب نمی‌شود،
        چون جلوی بارگذاری دوباره یا درخواست را نمی‌گیرد. ساخت کتاب، جستجوی شابک و ثبت درخواست
        همه از همین استفاده می‌کنند تا «این کتاب در مگابوک هست؟» همه‌جا یک معنا داشته باشد.
        """
        return cls.objects.exclude(status=cls.Status.REJECTED).filter(isbn=isbn).only("id", "status").first()

    def can_download_file(self, user):
        """Who may download the full file: admins, and users who own the book
        (the uploader and buyers; catalog/ownership.py, the one definition).

        For buyers the book's status is not checked: a bought book stays readable even
        if it's later taken off the store. The UPLOADER reads it only while it's
        approved: the library is for books that are on sale, and a pending or rejected
        upload is a record to track, not a book to read (DECISIONS 11.4).
        Every download path (the signed-link endpoint and the download view) asks
        this one method.
        """
        from .ownership import owned_book_ids

        if user is None or not user.is_authenticated or not user.is_active:
            return False
        if user.is_staff:
            return True
        if self.uploaded_by_id == user.pk:
            return self.status == self.Status.APPROVED
        return self.pk in owned_book_ids(user, [self.pk])

    @property
    def file_size(self):
        # حجم به بایت؛ از خود فایل خوانده می‌شود و ستونی در دیتابیس ندارد
        return self.book_file.size if self.book_file else None
