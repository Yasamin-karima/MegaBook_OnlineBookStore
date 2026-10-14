"""منابع بیرونی اطلاعات کتاب (فعلاً فقط Open Library).

view فقط lookup_isbn و SourceUnavailable را می‌شناسد و از جزئیات هیچ منبعی خبر ندارد.
برای عوض کردن منبع یا اضافه کردن منبع دوم:
1. یک ماژول کنار openlibrary.py بسازید با تابع fetch(isbn13) که همان قرارداد را دارد:
   - dict با کلیدهای BOOK_FIELDS برمی‌گرداند اگر پیدا شد،
   - None اگر منبع سالم است ولی این شابک را ندارد،
   - SourceUnavailable اگر منبع در دسترس نیست یا جواب نامعتبر داد.
2. fetch آن را به SOURCES اضافه کنید. view دست نمی‌خورد.
"""
from . import openlibrary
from .base import CoverDownloadError, SourceUnavailable
from .openlibrary import download_cover

# کلیدهای خروجی هر منبع، با اسم فیلدهای مدل Book (نه اسم‌های منبع بیرونی)
BOOK_FIELDS = ("title", "authors", "publisher", "page_count", "publication_year", "cover_url", "subjects")

# به ترتیب امتحان می‌شوند
SOURCES = [openlibrary.fetch]

__all__ = ["BOOK_FIELDS", "SOURCES", "CoverDownloadError", "SourceUnavailable", "download_cover", "lookup_isbn"]


def lookup_isbn(isbn13):
    """اطلاعات کتاب برای یک شابک ۱۳ رقمی معتبر.

    => dict (کلیدهای BOOK_FIELDS)، یا None اگر هیچ منبعی پیدا نکرد.
    اگر منبعی در دسترس نبود و منبع دیگری هم نتیجه نداد، SourceUnavailable بالا می‌رود؛
    چون در آن حالت نمی‌توانیم با اطمینان بگوییم «پیدا نشد».
    """
    unavailable = None
    for fetch in SOURCES:
        try:
            result = fetch(isbn13)
        except SourceUnavailable as error:
            unavailable = error
            continue
        if result is not None:
            return result
    if unavailable is not None:
        raise unavailable
    return None
