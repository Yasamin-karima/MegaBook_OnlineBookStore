"""Mobile phone number rules; the only place in the project they are defined.

The Account model, the login backend and the registration serializer all use
normalize_phone, so a number accepted at sign-up is always found again at login.
"""
import re

PHONE_EMPTY = "شماره موبایل را وارد کنید."
PHONE_INVALID = "شماره موبایل معتبر نیست. آن را به شکل ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید."

# Persian (۰-۹) and Arabic (٠-٩) digits to Latin digits
_LATIN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
# Whitespace, ASCII dash, and the Unicode dashes that come from copying out of Word or the web
_SEPARATORS = re.compile(r"[\s\-‐-―]")
# The national part of an Iranian mobile number: 9 followed by nine digits
_MOBILE = re.compile(r"9[0-9]{9}")


class InvalidPhone(ValueError):
    """Its message (str(error)) is Persian and is shown to the user as-is."""


def normalize_phone(raw):
    """Turn user input into the stored form 09xxxxxxxxx, or raise InvalidPhone.

    Accepts 09xxxxxxxxx, 9xxxxxxxxx, +989xxxxxxxxx, 00989xxxxxxxxx and 989xxxxxxxxx,
    with Persian or Latin digits, spaces and dashes.
    """
    value = _SEPARATORS.sub("", str(raw or "").translate(_LATIN_DIGITS))
    if not value:
        raise InvalidPhone(PHONE_EMPTY)

    if value.startswith("+98"):
        national = value[3:]
    elif value.startswith("0098"):
        national = value[4:]
    elif value.startswith("98") and len(value) == 12:
        # Only a 12-digit number starts with the 98 country code; a 10-digit
        # 98xxxxxxxx is already a national number starting with 9.
        national = value[2:]
    elif value.startswith("0"):
        national = value[1:]
    else:
        national = value

    if not _MOBILE.fullmatch(national):
        raise InvalidPhone(PHONE_INVALID)
    return "0" + national
