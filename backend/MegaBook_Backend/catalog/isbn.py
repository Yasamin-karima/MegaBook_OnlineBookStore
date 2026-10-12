"""ابزارهای شابک (ISBN)؛ تنها جای پروژه که قاعده‌ی شابک تعریف می‌شود.

serializer ساخت کتاب، دستور seed_books و جست‌وجوی شابک همه از همین فایل استفاده می‌کنند.
"""
import re

ISBN_CHECKSUM = "شابک نامعتبر است. رقم کنترلی آن درست نیست؛ شابک را با روی جلد مقایسه کنید."
ISBN_FORMAT = "شابک باید ۱۰ یا ۱۳ رقم باشد."
ISBN_EMPTY = "شابک را وارد کنید."

# رقم‌های فارسی (۰-۹) و عربی (٠-٩) به رقم لاتین
_LATIN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
# فاصله و انواع خط تیره (- و خط تیره‌های یونیکدی که از Word یا وب کپی می‌شوند)
_SEPARATORS = re.compile(r"[\s\-‐-―]")


class InvalidISBN(ValueError):
    """پیامش (str(error)) فارسی است و مستقیم به کاربر نشان داده می‌شود."""


def to_latin_digits(text):
    return text.translate(_LATIN_DIGITS)


def isbn13_is_valid(isbn):
    # رقم‌های فرد در ۱ و رقم‌های زوج در ۳ ضرب می‌شوند؛ رقم سیزدهم باید جمع را به مضرب ۱۰ برساند
    if len(isbn) != 13 or not isbn.isdigit():
        return False
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(isbn[:12]))
    return (10 - total % 10) % 10 == int(isbn[12])


def isbn10_is_valid(isbn):
    # رقم‌ها از چپ در ۱۰، ۹، ...، ۱ ضرب می‌شوند و جمع باید بر ۱۱ بخش‌پذیر باشد.
    # رقم آخر می‌تواند X باشد که یعنی ۱۰.
    if len(isbn) != 10 or not isbn[:9].isdigit() or not (isbn[9].isdigit() or isbn[9] == "X"):
        return False
    values = [int(d) for d in isbn[:9]] + [10 if isbn[9] == "X" else int(isbn[9])]
    return sum((10 - i) * v for i, v in enumerate(values)) % 11 == 0


def _isbn13_check_digit(first12):
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(first12))
    return str((10 - total % 10) % 10)


def isbn10_to_13(isbn10):
    # پیشوند 978 + نُه رقم اول، و رقم کنترلی از نو حساب می‌شود
    first12 = "978" + isbn10[:9]
    return first12 + _isbn13_check_digit(first12)


def isbn13_to_10(isbn13):
    """شکل ده‌رقمی همان شابک، یا None (فقط شابک‌های 978 نسخه‌ی ده‌رقمی دارند)."""
    if not isbn13.startswith("978"):
        return None
    core = isbn13[3:12]
    check = (11 - sum((10 - i) * int(d) for i, d in enumerate(core)) % 11) % 11
    return core + ("X" if check == 10 else str(check))


def normalize_isbn(raw):
    """ورودی کاربر را به شابک ۱۳ رقمی معتبر تبدیل می‌کند، یا InvalidISBN می‌دهد.

    قبول می‌کند: ISBN-10 یا ISBN-13، با یا بدون خط تیره و فاصله، با رقم فارسی یا لاتین.
    """
    value = _SEPARATORS.sub("", to_latin_digits(str(raw or ""))).upper()
    if not value:
        raise InvalidISBN(ISBN_EMPTY)
    if len(value) == 10 and value[:9].isdigit():
        if not isbn10_is_valid(value):
            raise InvalidISBN(ISBN_CHECKSUM)
        return isbn10_to_13(value)
    if len(value) == 13 and value.isdigit():
        if not isbn13_is_valid(value):
            raise InvalidISBN(ISBN_CHECKSUM)
        return value
    raise InvalidISBN(ISBN_FORMAT)
