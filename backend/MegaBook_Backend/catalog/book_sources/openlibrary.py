"""گرفتن اطلاعات کتاب از Open Library (بدون کلید API).

مستندات: https://openlibrary.org/dev/docs/api/books
فقط این فایل آدرس، شکل جواب و اسم فیلدهای Open Library را می‌شناسد.
"""
import logging
import re

import requests

from catalog.isbn import isbn13_to_10, to_latin_digits

from .base import SourceUnavailable

logger = logging.getLogger(__name__)

API_URL = "https://openlibrary.org/api/books"

# بدون timeout، requests تا ابد منتظر جواب می‌ماند؛ اگر Open Library کند یا قطع باشد،
# worker سرور ما هم گیر می‌کند و درخواست‌های بقیه‌ی کاربران پشتش صف می‌کشند.
# این عدد جداگانه برای «وصل شدن» و برای «هر بار منتظر ماندن برای داده» اعمال می‌شود.
TIMEOUT_SECONDS = 5

# Open Library می‌خواهد برنامه‌ها خودشان را با User-Agent معرفی کنند
HEADERS = {"User-Agent": "MegaBook/0.1 (Persian eBook store; ISBN metadata lookup)"}

_YEAR = re.compile(r"(?<!\d)(\d{4})(?!\d)")


def fetch(isbn13):
    """=> dict با اسم فیلدهای مدل ما، یا None اگر Open Library این شابک را ندارد.
    اگر Open Library در دسترس نباشد یا جواب نامعتبر بدهد: SourceUnavailable.
    """
    # بعضی کتاب‌ها فقط با شابک ده‌رقمی ثبت شده‌اند؛ هر دو را در همین یک درخواست می‌پرسیم
    keys = [f"ISBN:{isbn13}"]
    isbn10 = isbn13_to_10(isbn13)
    if isbn10:
        keys.append(f"ISBN:{isbn10}")

    try:
        response = requests.get(
            API_URL,
            params={"bibkeys": ",".join(keys), "format": "json", "jscmd": "data"},
            headers=HEADERS,
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()  # 4xx و 5xx را به خطا تبدیل می‌کند
        data = response.json()
    except requests.Timeout as error:
        logger.warning("Open Library timed out for %s", isbn13)
        raise SourceUnavailable("timeout") from error
    except requests.RequestException as error:
        # قطع شبکه، خطای DNS، وضعیت 5xx، یا بدنه‌ای که JSON نیست
        logger.warning("Open Library request failed for %s: %s", isbn13, error)
        raise SourceUnavailable(str(error)) from error

    if not isinstance(data, dict):
        raise SourceUnavailable("unexpected response shape")

    # شابکِ ناشناخته یک شیء خالی {} برمی‌گرداند
    entry = next((data[key] for key in keys if key in data), None)
    if entry is None:
        return None
    if not isinstance(entry, dict):
        raise SourceUnavailable("unexpected entry shape")
    return _to_book_fields(entry)


def _to_book_fields(entry):
    """جواب Open Library را به اسم فیلدهای مدل Book تبدیل می‌کند. مقدار ناموجود: None یا []."""
    publishers = _names(entry.get("publishers"))
    return {
        "title": _text(entry.get("title")),
        "authors": _names(entry.get("authors")),
        "publisher": publishers[0] if publishers else None,
        "page_count": _positive_int(entry.get("number_of_pages")),
        "publication_year": _year(entry.get("publish_date")),
        "cover_url": _largest_cover(entry.get("cover")),
        "subjects": _names(entry.get("subjects")),
    }


def _text(value):
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _names(items):
    # [{"name": "..."}, ...] -> ["...", ...]؛ هر چیز دیگری (یا ورودی خراب) نادیده گرفته می‌شود
    if not isinstance(items, list):
        return []
    names = [_text(item.get("name")) for item in items if isinstance(item, dict)]
    return [name for name in names if name]


def _positive_int(value):
    # bool هم در پایتون int حساب می‌شود؛ آن را نمی‌خواهیم
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return None


def _year(publish_date):
    # publish_date قالب ثابتی ندارد: "1989"، "May 1989"، "1368 [1989]"، ...
    # اولین عدد چهاررقمی را برمی‌داریم، همان‌طور که نوشته شده (تبدیل شمسی/میلادی نمی‌کنیم)
    if not isinstance(publish_date, str):
        return None
    match = _YEAR.search(to_latin_digits(publish_date))
    return int(match.group(1)) if match else None


def _largest_cover(cover):
    if not isinstance(cover, dict):
        return None
    for size in ("large", "medium", "small"):
        url = _text(cover.get(size))
        if url:
            return url
    return None
