"""Bank tracking numbers and card numbers; the only place their rules are defined.

Like accounts/phone.py and catalog/isbn.py: models, serializers and services all use
these, so a number accepted in one place is stored and compared the same way everywhere.
"""
import re

TRACKING_EMPTY = "شماره پیگیری واریز را وارد کنید."
TRACKING_INVALID = "شماره پیگیری فقط می‌تواند رقم و حروف انگلیسی داشته باشد."
CARD_EMPTY = "شماره کارت را وارد کنید."
CARD_LENGTH = "شماره کارت باید ۱۶ رقم باشد."
CARD_CHECKSUM = "شماره کارت معتبر نیست. آن را با روی کارت مقایسه کنید."

TRACKING_MAX_LENGTH = 50

# Persian (۰-۹) and Arabic (٠-٩) digits to Latin digits
_LATIN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
# Whitespace, ASCII dash, and the Unicode dashes that come from copying out of Word or the web
_SEPARATORS = re.compile(r"[\s\-‐-―]")
_TRACKING = re.compile(rf"[0-9A-Z]{{1,{TRACKING_MAX_LENGTH}}}")
_CARD = re.compile(r"[0-9]{16}")


class InvalidNumber(ValueError):
    """Its message (str(error)) is Persian and is shown to the user as-is."""


def _clean(raw):
    return _SEPARATORS.sub("", str(raw or "").translate(_LATIN_DIGITS)).upper()


def normalize_tracking_number(raw):
    """Latin digits and capital letters, no spaces or dashes; or InvalidNumber.

    Some banks' tracking codes have letters, so letters are allowed; uppercasing
    makes "ab12" and "AB12" the same number for the uniqueness check.
    """
    value = _clean(raw)
    if not value:
        raise InvalidNumber(TRACKING_EMPTY)
    if not _TRACKING.fullmatch(value):
        raise InvalidNumber(TRACKING_INVALID)
    return value


def luhn_is_valid(digits):
    """The Luhn checksum every bank card number satisfies (catches most typos).

    From the right, every second digit is doubled (minus 9 if over 9); the total
    must be a multiple of 10.
    """
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d = d * 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def normalize_card_number(raw):
    """16 Latin digits with a valid Luhn checksum; or InvalidNumber."""
    value = _clean(raw)
    if not value:
        raise InvalidNumber(CARD_EMPTY)
    if not _CARD.fullmatch(value):
        raise InvalidNumber(CARD_LENGTH)
    if not luhn_is_valid(value):
        raise InvalidNumber(CARD_CHECKSUM)
    return value


def mask_card_number(card):
    """6037 99** **** 1234: the first six digits name the bank, the last four identify the card."""
    if not card or len(card) != 16:
        return ""
    return f"{card[:4]} {card[4:6]}** **** {card[12:]}"


def group_card_number(card):
    """6037 9912 3456 1234: the full number in groups of four, for the admin who pays it out."""
    return " ".join(card[i:i + 4] for i in range(0, len(card), 4))
