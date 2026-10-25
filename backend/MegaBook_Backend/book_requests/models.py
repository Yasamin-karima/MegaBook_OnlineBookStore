from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q

# چرا دو جدول؟
# BookRequest وضعیت «کتاب» است: یک ردیف برای هر شابک، و مدیر یک بار درباره‌اش تصمیم می‌گیرد.
# RequestEntry می‌گوید «چه کسی» آن کتاب را می‌خواهد: یک ردیف برای هر کاربر.
# اگر ده نفر یک کتاب را بخواهند، یک BookRequest و ده RequestEntry داریم، نه ده درخواست
# جدا که مدیر باید ده بار وضعیتشان را عوض کند (و ممکن است با هم ناهماهنگ شوند).

REJECTION_REASON_REQUIRED = "برای رد کردن درخواست، دلیل رد را بنویسید."


class BookRequest(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "در انتظار تامین"
        FULFILLED = "fulfilled", "تامین شده"
        REJECTED = "rejected", "رد شده"

    # سیزده رقم، بدون خط تیره (catalog.isbn.normalize_isbn)؛ یکتا: هر شابک فقط یک درخواست
    isbn = models.CharField(max_length=13, unique=True)
    # از نتیجه‌ی جستجو یا ورود دستی اولین درخواست‌کننده؛ متن ساده، بدون رابطه با catalog.Person
    title = models.CharField(max_length=300)
    authors = models.CharField(max_length=500, blank=True)
    cover_url = models.URLField(max_length=500, blank=True)

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    # Sent to every requester in a system message when the request is rejected (support app)
    rejection_reason = models.TextField(blank=True, help_text="این متن عیناً برای کاربر ارسال می‌شود")
    # When an admin last looked at it in the admin dashboard (a save, or "mark reviewed").
    # Empty = "new": an open request nobody has reviewed yet. Kept if it reopens.
    reviewed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # لایه‌ی آخر قانون وضعیت، در خود دیتابیس. save() جلوی خطا را می‌گیرد، ولی
            # QuerySet.update() یا SQL مستقیم از save() رد نمی‌شوند؛ این قید آن‌ها را هم می‌گیرد:
            # یا «رد شده با دلیل»، یا «هر وضعیت دیگر بدون دلیل».
            models.CheckConstraint(
                condition=(
                    (Q(status="rejected") & ~Q(rejection_reason=""))
                    | (~Q(status="rejected") & Q(rejection_reason=""))
                ),
                name="book_request_rejection_reason_matches_status",
            ),
        ]

    def __str__(self):
        return f"{self.title} ({self.isbn})"

    def apply_status_rules(self):
        """قانون‌های وضعیت؛ هم clean() و هم save() این را صدا می‌زنند.

        - رد شده بدون دلیل: خطا
        - هر وضعیتی جز رد شده: دلیل رد پاک می‌شود (مثلاً وقتی مدیر رد شده را دوباره باز می‌کند)
        مدیر می‌تواند وضعیت را در هر جهتی عوض کند؛ اینجا محدودیتی روی جهت تغییر نیست.
        """
        self.rejection_reason = (self.rejection_reason or "").strip()
        if self.status == self.Status.REJECTED:
            if not self.rejection_reason:
                raise ValidationError({"rejection_reason": REJECTION_REASON_REQUIRED})
        else:
            self.rejection_reason = ""

    def clean(self):
        # جنگو clean() را فقط در full_clean() صدا می‌زند، و full_clean() را فقط فرم‌ها
        # (از جمله فرم ادمین) صدا می‌زنند؛ یک save() ساده آن را صدا نمی‌زند.
        # اینجا هست تا فرم ادمین خطا را کنار همان فیلد نشان دهد.
        super().clean()
        self.apply_status_rules()

    def save(self, *args, **kwargs):
        # اینجا هست تا قانون هر طور که شیء ذخیره شود برقرار بماند: ادمین، داشبورد React
        # آینده، shell، یا هر کد دیگری که obj.save() را صدا بزند.
        self.apply_status_rules()
        previous = _stored_status(self)
        with transaction.atomic():
            super().save(*args, **kwargs)
            if previous is not None and previous != self.status:
                # The single path for "the status changed": every requester gets a system
                # message in their own conversation (DECISIONS 12.3). Imported here because
                # the support app depends on this one, not the other way round.
                from support.services import on_request_status_changed

                on_request_status_changed(self, previous)
                if self.status in (self.Status.FULFILLED, self.Status.REJECTED):
                    _notify_requesters(self)


def _notify_requesters(book_request):
    """Fulfilled or rejected: one notification per requester, in one INSERT. Each links to
    the requester's own RequestEntry; the text never says how many asked or who uploaded."""
    from catalog.models import Book
    from notifications import services as notifications

    if book_request.status == BookRequest.Status.FULFILLED:
        kind = notifications.Type.REQUEST_FULFILLED
        params = {"title": book_request.title}
        # The book on sale with this ISBN, for the link
        book = Book.objects.filter(isbn=book_request.isbn, status=Book.Status.APPROVED).first()
    else:
        kind = notifications.Type.REQUEST_REJECTED
        params = {"title": book_request.title, "reason": book_request.rejection_reason}
        book = None
    entries = book_request.entries.select_related("requester")
    notifications.notify(
        kind, [(entry.requester, {"request_entry": entry}) for entry in entries],
        params=params, book_request=book_request, book=book,
    )


def _stored_status(obj):
    """The status currently in the database (None for a new object)."""
    if obj._state.adding or obj.pk is None:
        return None
    return type(obj).objects.filter(pk=obj.pk).values_list("status", flat=True).first()


class RequestEntry(models.Model):
    """یک کاربر که یک BookRequest را خواسته است.

    «درخواست‌های من»، شمارش‌های داشبورد و اعلان‌های آینده این جدول را می‌خوانند،
    و تیکت‌های گفتگوی مدیر با هر درخواست‌کننده بعداً به همین مدل وصل می‌شوند.
    """
    request = models.ForeignKey(BookRequest, on_delete=models.CASCADE, related_name="entries")
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="book_request_entries",
    )
    # توضیحات خود این کاربر (هر درخواست‌کننده توضیح خودش را دارد)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name_plural = "request entries"
        constraints = [
            # هر کاربر برای هر کتاب فقط یک بار؛ حتی اگر دو درخواست هم‌زمان برسند (دابل‌کلیک)
            models.UniqueConstraint(fields=["request", "requester"], name="unique_request_entry_per_user"),
        ]

    def __str__(self):
        return f"{self.requester} → {self.request.isbn}"
