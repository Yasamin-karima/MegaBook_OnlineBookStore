"""قانون‌های ثبت درخواست کتاب، جدا از HTTP.

view فقط ورودی را اعتبارسنجی می‌کند، submit_request را صدا می‌زند و نتیجه را به پاسخ HTTP
تبدیل می‌کند. داشبورد مدیر یا هر کد دیگری که بعداً بخواهد درخواست ثبت کند، همین تابع را صدا می‌زند.
"""
from dataclasses import dataclass

from django.db import IntegrityError, transaction

from catalog.models import Book

from .models import BookRequest, RequestEntry

# مقدار فیلد result در پاسخ API؛ فرانت روی این‌ها شاخه می‌زند
REQUESTED = "requested"
AVAILABLE = "available"
IN_REVIEW = "in_review"
REJECTED = "rejected"
ALREADY_REQUESTED = "already_requested"
# Only with require_open=True ("I want this too" on the public list)
NOT_OPEN = "not_open"


@dataclass
class SubmitOutcome:
    result: str
    book_id: int | None = None  # فقط برای AVAILABLE
    rejection_reason: str = ""  # فقط برای REJECTED


def submit_request(user, *, isbn, title, authors="", cover_url="", notes="", require_open=False):
    """درخواست کاربر برای یک شابک (۱۳ رقمیِ معتبر). همه‌چیز در یک تراکنش.

    ترتیب بررسی:
      ۱. کتاب تاییدشده با این شابک هست        -> AVAILABLE، چیزی ساخته نمی‌شود
      ۲. کتاب با این شابک در انتظار بررسی است -> IN_REVIEW، چیزی ساخته نمی‌شود
         (کتاب در راه است؛ درخواست فقط کار اضافه برای مدیر است)
      ۳. درخواست این شابک رد شده است          -> REJECTED، چیزی ساخته نمی‌شود
      ۴. همین کاربر قبلاً درخواست داده         -> ALREADY_REQUESTED، چیزی ساخته نمی‌شود
      ۵. درخواست باز یا تامین‌شده هست         -> فقط RequestEntry این کاربر اضافه می‌شود
      ۶. درخواستی نیست                        -> BookRequest و RequestEntry ساخته می‌شوند
    ۵ و ۶ هر دو REQUESTED برمی‌گردانند تا معلوم نشود کس دیگری قبلاً درخواست داده یا نه.
    کتاب «رد شده» جلوی درخواست را نمی‌گیرد، چون دوباره قابل بارگذاری است (catalog.Book).

    require_open=True (دکمه‌ی «من هم می‌خواهم» در لیست عمومی): فقط به درخواست «باز» می‌شود
    پیوست. اگر وضعیت تا لحظه‌ی تأیید کاربر عوض شده باشد، NOT_OPEN برمی‌گردد. این بررسی بعد از
    قفل ردیف است، پس مدیر نمی‌تواند بین بررسی و ساخته شدن RequestEntry وضعیت را عوض کند.
    """
    with transaction.atomic():
        book = Book.active_for_isbn(isbn)
        if book and book.status == Book.Status.APPROVED:
            return SubmitOutcome(AVAILABLE, book_id=book.id)
        if book and book.status == Book.Status.PENDING:
            return SubmitOutcome(IN_REVIEW)

        # get_or_create: اگر دو کاربر هم‌زمان یک شابک جدید بفرستند، هر دو سعی می‌کنند INSERT کنند.
        # قید unique روی isbn دومی را رد می‌کند (IntegrityError)؛ خود get_or_create این خطا را
        # داخل یک savepoint می‌گیرد و ردیفی را که اولی ساخته برمی‌دارد. پس فقط یک BookRequest.
        # select_for_update: ردیف تا پایان تراکنش قفل می‌ماند، تا مدیر نتواند بین بررسی وضعیت
        # (پایین) و اضافه شدن RequestEntry وضعیت را عوض کند.
        book_request, _created = BookRequest.objects.select_for_update().get_or_create(
            isbn=isbn,
            # فقط وقتی ساخته می‌شود به کار می‌رود؛ اگر درخواست از قبل بود، اطلاعات اولین نفر می‌ماند
            defaults={"title": title, "authors": authors, "cover_url": cover_url},
        )

        if require_open and book_request.status != BookRequest.Status.OPEN:
            return SubmitOutcome(NOT_OPEN)
        if book_request.status == BookRequest.Status.REJECTED:
            return SubmitOutcome(REJECTED, rejection_reason=book_request.rejection_reason)

        if RequestEntry.objects.filter(request=book_request, requester=user).exists():
            return SubmitOutcome(ALREADY_REQUESTED)

        try:
            # savepoint جدا: اگر قید unique (request, requester) خطا بدهد (مثلاً دابل‌کلیک که
            # از بررسی بالا هم‌زمان رد شده)، فقط همین بخش برمی‌گردد، نه کل تراکنش
            with transaction.atomic():
                RequestEntry.objects.create(request=book_request, requester=user, notes=notes)
        except IntegrityError:
            return SubmitOutcome(ALREADY_REQUESTED)

    return SubmitOutcome(REQUESTED)


# ---------------------------------------------------------------------------
# A book with the same ISBN goes on sale or leaves the store (DECISIONS 5.14)
# ---------------------------------------------------------------------------

def sync_with_book(book, previous):
    """Called from Book.save() (inside its transaction) when a book is created approved
    or its status changes. The request for that ISBN follows the store:

    - the book is approved (or created approved) -> an OPEN request becomes fulfilled;
    - the book leaves approved and no other approved book has that ISBN -> a fulfilled
      request goes back to open.

    Each change goes through BookRequest.save(), so every requester gets the system
    message and their conversations close or reopen by the usual rules (12.3, 12.4).
    A rejected request is never changed here: rejecting is the admin's decision.
    """
    approved = Book.Status.APPROVED
    if book.status == approved and previous != approved:
        _set_status(book.isbn, BookRequest.Status.OPEN, BookRequest.Status.FULFILLED)
    elif previous == approved and book.status != approved:
        still_on_sale = Book.objects.filter(isbn=book.isbn, status=approved).exclude(pk=book.pk).exists()
        if not still_on_sale:
            _set_status(book.isbn, BookRequest.Status.FULFILLED, BookRequest.Status.OPEN)


def _set_status(isbn, from_status, to_status):
    book_request = BookRequest.objects.select_for_update().filter(isbn=isbn, status=from_status).first()
    if book_request is not None:
        book_request.status = to_status
        book_request.save()


def open_requests_already_on_sale():
    """Open requests whose ISBN already has an approved book (data from before 5.14)."""
    on_sale = Book.objects.filter(status=Book.Status.APPROVED).values("isbn")
    return BookRequest.objects.filter(status=BookRequest.Status.OPEN, isbn__in=on_sale)
