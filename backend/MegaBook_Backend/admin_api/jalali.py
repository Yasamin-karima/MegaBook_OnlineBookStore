"""The Jalali (Persian) calendar, for "today" and "this month" on the admin home page.

The server decides where a day and a month begin, in Tehran time, so every admin
sees the same numbers whatever their browser's clock or time zone. A small, well
known conversion (the arithmetic of the 33-year cycle used by jdf / jdatetime)
instead of a new dependency.
"""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TEHRAN = ZoneInfo("Asia/Tehran")

MONTH_NAMES = (
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
)
_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def gregorian_to_jalali(gy, gm, gd):
    g_d_m = (0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)
    gy2 = gy + 1 if gm > 2 else gy
    days = 355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400 + gd + g_d_m[gm - 1]
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        return jy, 1 + days // 31, 1 + days % 31
    return jy, 7 + (days - 186) // 30, 1 + (days - 186) % 30


def jalali_to_gregorian(jy, jm, jd):
    jy += 1595
    days = -355668 + 365 * jy + (jy // 33) * 8 + ((jy % 33) + 3) // 4 + jd
    days += (jm - 1) * 31 if jm < 7 else (jm - 7) * 30 + 186
    gy = 400 * (days // 146097)
    days %= 146097
    if days > 36524:
        days -= 1
        gy += 100 * (days // 36524)
        days %= 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        gy += (days - 1) // 365
        days = (days - 1) % 365
    gd = days + 1
    leap = (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0
    month_days = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    gm = 0
    while gd > month_days[gm]:
        gd -= month_days[gm]
        gm += 1
    return gy, gm + 1, gd


def _midnight(day):
    return datetime(day.year, day.month, day.day, tzinfo=TEHRAN)


def periods(now):
    """{today_start, month_start, tomorrow_start, today_label, month_label} for an aware `now`.

    today_start: midnight in Tehran; month_start: midnight in Tehran on the 1st of the
    current Jalali month. Ranges are [start, tomorrow_start).
    """
    local = now.astimezone(TEHRAN)
    today = local.date()
    jy, jm, jd = gregorian_to_jalali(today.year, today.month, today.day)
    first = date(*jalali_to_gregorian(jy, jm, 1))
    return {
        "today_start": _midnight(today),
        "tomorrow_start": _midnight(today + timedelta(days=1)),
        "month_start": _midnight(first),
        "today_label": f"{jd} {MONTH_NAMES[jm - 1]} {jy}".translate(_FA_DIGITS),
        "month_label": f"{MONTH_NAMES[jm - 1]} {jy}".translate(_FA_DIGITS),
    }
