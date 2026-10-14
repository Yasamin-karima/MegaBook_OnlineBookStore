"""گرفتن اطلاعات کتاب از Open Library (بدون کلید API).

مستندات: https://openlibrary.org/dev/docs/api/books
فقط این فایل آدرس، شکل جواب و اسم فیلدهای Open Library را می‌شناسد.
"""
import io
import logging
import re
import time
import warnings
from urllib.parse import urljoin, urlsplit

import requests
from django.core.files.base import ContentFile
from PIL import Image

from catalog.isbn import isbn13_to_10, to_latin_digits

from .base import CoverDownloadError, SourceUnavailable

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


# ---------------------------------------------------------------------------
# دانلود جلد از Open Library
#
# چرا این‌قدر سخت‌گیر؟ (SSRF)
# وقتی سرور ما آدرسی را که کاربر فرستاده دانلود می‌کند، درخواست از «داخل» شبکه‌ی سرور
# فرستاده می‌شود، نه از مرورگر کاربر. اگر هر آدرسی قبول شود، مهاجم می‌تواند سرور را وادار کند
# چیزهایی را بخواند که خودش به آن‌ها دسترسی ندارد: http://db:5432 داخل Docker، پنل‌های داخلی،
# یا آدرس metadata سرویس ابری (169.254.169.254) که کلیدهای دسترسی را برمی‌گرداند.
# پس فقط میزبان‌های مشخص Open Library و Internet Archive، فقط با HTTPS.
#
# چرا بررسی آدرس اول کافی نیست؟ اگر کتابخانه‌ی HTTP خودش تغییر مسیر (redirect) را دنبال کند،
# آدرس اول مجاز است ولی جواب آن می‌تواند بگوید «برو به http://127.0.0.1/...» و کتابخانه بی‌آنکه
# ما ببینیم آن را هم درخواست می‌کند. پس redirect خودکار خاموش است و هر قدم را قبل از درخواست
# خودمان بررسی می‌کنیم.
# ---------------------------------------------------------------------------

COVER_FIRST_HOST = "covers.openlibrary.org"
COVER_TIMEOUT_SECONDS = 10  # کل دانلود، همه‌ی قدم‌ها روی هم
COVER_MAX_BYTES = 5 * 1024 * 1024  # همان سقف جلدی که کاربر آپلود می‌کند
COVER_MAX_REDIRECTS = 5
COVER_CHUNK_BYTES = 64 * 1024
COVER_FORMATS = {"JPEG": "jpg", "PNG": "png"}
_REDIRECT_CODES = {301, 302, 303, 307, 308}


def _cover_host_allowed(host):
    # covers.openlibrary.org، خود archive.org، یا زیردامنه‌اش (مثل ia800507.us.archive.org).
    # «.archive.org» با نقطه: evilarchive.org یا archive.org.evil.com قبول نمی‌شوند.
    return host == COVER_FIRST_HOST or host == "archive.org" or host.endswith(".archive.org")


def _check_cover_url(url, first):
    """هر قدم، قبل از درخواست. هر ایرادی: CoverDownloadError."""
    try:
        parts = urlsplit(url)
        port = parts.port  # پورت نامعتبر ValueError می‌دهد
    except ValueError as error:
        raise CoverDownloadError(f"invalid url: {url!r}") from error
    host = (parts.hostname or "").lower()
    if parts.scheme != "https":
        raise CoverDownloadError(f"not https: {url!r}")
    # https://covers.openlibrary.org@evil.com/ میزبانش evil.com است؛ اسم کاربری در آدرس را قبول نمی‌کنیم
    if parts.username or parts.password:
        raise CoverDownloadError(f"credentials in url: {url!r}")
    if port not in (None, 443):
        raise CoverDownloadError(f"unexpected port: {url!r}")
    if first and host != COVER_FIRST_HOST:
        raise CoverDownloadError(f"cover must start at {COVER_FIRST_HOST}: {url!r}")
    if not _cover_host_allowed(host):
        raise CoverDownloadError(f"host not allowed: {host!r}")


def _read_limited(response, deadline):
    """بدنه را تکه‌تکه می‌خواند و همان لحظه که از سقف حجم یا زمان گذشت متوقف می‌شود.

    کل فایل هیچ‌وقت یک‌جا خوانده نمی‌شود: اگر سرور فایل ۲ گیگابایتی بفرستد (یا در Content-Length
    دروغ بگوید)، حداکثر کمی بیشتر از ۵ مگابایت در حافظه می‌آید.
    """
    declared = response.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > COVER_MAX_BYTES:
        raise CoverDownloadError(f"too large (Content-Length {declared})")
    data = bytearray()
    for chunk in response.iter_content(chunk_size=COVER_CHUNK_BYTES):
        data += chunk
        if len(data) > COVER_MAX_BYTES:
            raise CoverDownloadError("too large while streaming")
        # timeout در requests برای «هر بار انتظار» است، نه کل دانلود؛ سروری که هر چند ثانیه
        # یک بایت بفرستد بدون این بررسی دانلود را تا ابد طول می‌دهد
        if time.monotonic() > deadline:
            raise CoverDownloadError("took too long")
    return bytes(data)


def _to_image_file(data, isbn):
    """بایت‌ها را با Pillow باز می‌کند (به آدرس یا Content-Type اعتماد نمی‌کنیم) و فایل قابل ذخیره می‌سازد."""
    try:
        with warnings.catch_warnings():
            # تصویری با تعداد پیکسل غیرعادی (bomb) را رد کن، نه فقط هشدار
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                image_format = image.format
                image.verify()  # ساختار فایل را بدون کشیدن کامل تصویر بررسی می‌کند
    except Exception as error:  # Pillow برای فایل خراب انواع مختلفی خطا می‌دهد
        raise CoverDownloadError(f"not a valid image: {error}") from error
    extension = COVER_FORMATS.get(image_format)
    if extension is None:
        raise CoverDownloadError(f"unsupported image format: {image_format}")
    # ContentFile فایلِ در حافظه است؛ ImageField آن را مثل فایل آپلودشده در upload_to ذخیره می‌کند
    return ContentFile(data, name=f"{isbn}.{extension}")


def download_cover(url, isbn):
    """جلد را از Open Library دانلود و تایید می‌کند. => ContentFile آماده‌ی Book.cover.

    هر ایرادی (آدرس یا redirect غیرمجاز، خطای شبکه، کندی، حجم زیاد، تصویر نامعتبر):
    CoverDownloadError. چیزی ذخیره نمی‌شود؛ ذخیره کار serializer است.
    """
    deadline = time.monotonic() + COVER_TIMEOUT_SECONDS
    current = url
    # قدم ۰ آدرس اصلی است، بعد حداکثر ۵ redirect
    for hop in range(COVER_MAX_REDIRECTS + 1):
        _check_cover_url(current, first=(hop == 0))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CoverDownloadError("took too long")
        try:
            response = requests.get(
                current,
                headers=HEADERS,
                timeout=remaining,
                stream=True,  # بدنه هنوز خوانده نشده؛ _read_limited تکه‌تکه می‌خواند
                allow_redirects=False,  # redirect را خودمان دنبال و بررسی می‌کنیم
            )
        except requests.RequestException as error:
            logger.warning("Cover download failed for %s: %s", isbn, error)
            raise CoverDownloadError(str(error)) from error

        try:
            if response.status_code in _REDIRECT_CODES:
                location = response.headers.get("Location")
                if not location:
                    raise CoverDownloadError("redirect without Location")
                # Location ممکن است نسبی باشد؛ نسبت به آدرس فعلی کامل می‌شود و در قدم بعد بررسی می‌شود
                current = urljoin(current, location)
                continue
            if response.status_code != 200:
                raise CoverDownloadError(f"HTTP {response.status_code}")
            try:
                data = _read_limited(response, deadline)
            except requests.RequestException as error:
                raise CoverDownloadError(str(error)) from error
        finally:
            response.close()
        return _to_image_file(data, isbn)

    raise CoverDownloadError("too many redirects")
