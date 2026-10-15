"""دستور seed_books: کتاب‌های نمونه را در دیتابیس می‌سازد.

اجرا (از ریشه‌ی پروژه):
    docker compose exec backend python manage.py seed_books

چند بار اجرا کردنش امن است:
- کتابی که شابکش از قبل وجود دارد، رد می‌شود (نه تکراری ساخته می‌شود، نه تغییر می‌کند).
- Person، Publisher، Category و Tag با نامشان پیدا می‌شوند و فقط اگر نبودند ساخته می‌شوند.
- The sample uploader (SAMPLE_UPLOADER_EMAIL) is found by email and created only if missing.
- هیچ داده‌ی موجودی ویرایش یا حذف نمی‌شود.

Two uploaders, so the sample data shows both money cases:
- the first superuser, for books marked "uploader": "admin" (seller_share is always 0);
- a regular "sample uploader" account for the rest (they get a seller_share). It has an
  unusable password, so nobody can log in with it; it exists only to own sample books.

فایل‌ها از اینترنت دانلود نمی‌شوند: جلد با Pillow ساخته می‌شود (رنگ ساده + عنوان)
و فایل کتاب و نمونه یک PDF کوچک است که فقط می‌گوید فایل نمونه است.
"""

import io
import textwrap
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from PIL import Image, ImageDraw, ImageFont

from catalog.management.seed_data import CATEGORIES, SAMPLE_BOOKS
from catalog.models import Book, Category, Person, Publisher, Tag
from catalog.isbn import isbn13_is_valid

SAMPLE_UPLOADER_EMAIL = "sample-uploader@megabook.invalid"  # .invalid: a reserved domain, never real

FONT_PATH = Path(__file__).resolve().parent.parent / "fonts" / "Vazirmatn-Bold.ttf"
COVER_SIZE = (600, 900)


# ---------------------------------------------------------------------------
# متن فارسی روی جلد
#
# Pillow برای چسباندن حروف فارسی و راست‌به‌چپ نوشتن به کتابخانه‌ی سیستمی libraqm نیاز دارد
# که در کانتینر ما نصب نیست. به‌جای اضافه کردن وابستگی، اینجا کار ساده‌ای می‌کنیم:
# ۱. هر حرف را به «شکل نمایشی» درستش (تنها، آخر، اول، وسط) تبدیل می‌کنیم؛
#    یونیکد برای هر حرف این شکل‌ها را جدا دارد (Arabic Presentation Forms).
# ۲. ترتیب حروف را برعکس می‌کنیم، چون Pillow همیشه از چپ به راست می‌نویسد.
# این برای عنوان‌های کوتاه بدون عدد و حروف لاتین کافی است، نه برای متن عمومی.
# ---------------------------------------------------------------------------

# (تنها، آخر، اول، وسط). حروفی که فقط دو شکل دارند به حرف بعدی نمی‌چسبند (مثل ا، د، ر، و).
FORMS = {
    "ء": ("ﺀ",),
    "آ": ("ﺁ", "ﺂ"),
    "ا": ("ﺍ", "ﺎ"),
    "ئ": ("ﺉ", "ﺊ", "ﺋ", "ﺌ"),
    "ب": ("ﺏ", "ﺐ", "ﺑ", "ﺒ"),
    "پ": ("ﭖ", "ﭗ", "ﭘ", "ﭙ"),
    "ت": ("ﺕ", "ﺖ", "ﺗ", "ﺘ"),
    "ث": ("ﺙ", "ﺚ", "ﺛ", "ﺜ"),
    "ج": ("ﺝ", "ﺞ", "ﺟ", "ﺠ"),
    "چ": ("ﭺ", "ﭻ", "ﭼ", "ﭽ"),
    "ح": ("ﺡ", "ﺢ", "ﺣ", "ﺤ"),
    "خ": ("ﺥ", "ﺦ", "ﺧ", "ﺨ"),
    "د": ("ﺩ", "ﺪ"),
    "ذ": ("ﺫ", "ﺬ"),
    "ر": ("ﺭ", "ﺮ"),
    "ز": ("ﺯ", "ﺰ"),
    "ژ": ("ﮊ", "ﮋ"),
    "س": ("ﺱ", "ﺲ", "ﺳ", "ﺴ"),
    "ش": ("ﺵ", "ﺶ", "ﺷ", "ﺸ"),
    "ص": ("ﺹ", "ﺺ", "ﺻ", "ﺼ"),
    "ض": ("ﺽ", "ﺾ", "ﺿ", "ﻀ"),
    "ط": ("ﻁ", "ﻂ", "ﻃ", "ﻄ"),
    "ظ": ("ﻅ", "ﻆ", "ﻇ", "ﻈ"),
    "ع": ("ﻉ", "ﻊ", "ﻋ", "ﻌ"),
    "غ": ("ﻍ", "ﻎ", "ﻏ", "ﻐ"),
    "ف": ("ﻑ", "ﻒ", "ﻓ", "ﻔ"),
    "ق": ("ﻕ", "ﻖ", "ﻗ", "ﻘ"),
    "ک": ("ﮎ", "ﮏ", "ﮐ", "ﮑ"),
    "گ": ("ﮒ", "ﮓ", "ﮔ", "ﮕ"),
    "ل": ("ﻝ", "ﻞ", "ﻟ", "ﻠ"),
    "م": ("ﻡ", "ﻢ", "ﻣ", "ﻤ"),
    "ن": ("ﻥ", "ﻦ", "ﻧ", "ﻨ"),
    "و": ("ﻭ", "ﻮ"),
    "ه": ("ﻩ", "ﻪ", "ﻫ", "ﻬ"),
    "ی": ("ﯼ", "ﯽ", "ﯾ", "ﯿ"),
}
# «لا» در فارسی یک شکل ترکیبی دارد: (تنها، آخر)
LAM_ALEF = {"ا": ("ﻻ", "ﻼ"), "آ": ("ﻵ", "ﻶ")}
ZWNJ = "‌"  # نیم‌فاصله: اتصال را می‌شکند و خودش دیده نمی‌شود


def is_persian(text):
    return any(ch in FORMS for ch in text)


def _connects_forward(ch):
    # حرفی که چهار شکل دارد، به حرف بعدی‌اش می‌چسبد
    return ch in FORMS and len(FORMS[ch]) == 4


def shape_persian(text):
    """متن فارسی منطقی را به رشته‌ای تبدیل می‌کند که Pillow درست (چسبیده و راست‌به‌چپ) بکشد."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        prev = text[i - 1] if i > 0 else ""
        nxt = text[i + 1] if i + 1 < len(text) else ""
        joins_prev = _connects_forward(prev)

        if ch == "ل" and nxt in LAM_ALEF:
            out.append(LAM_ALEF[nxt][1 if joins_prev else 0])
            i += 2
            continue

        forms = FORMS.get(ch)
        if forms:
            joins_next = len(forms) == 4 and nxt in FORMS
            if joins_prev and joins_next:
                out.append(forms[3])
            elif joins_prev:
                out.append(forms[1])
            elif joins_next:
                out.append(forms[2])
            else:
                out.append(forms[0])
        elif ch != ZWNJ:
            out.append(ch)
        i += 1
    return "".join(reversed(out))


def wrap_lines(text, font, max_width):
    """متن را کلمه به کلمه در خط‌هایی می‌شکند که از max_width پهن‌تر نشوند."""
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and font.getlength(display(candidate)) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def display(text):
    return shape_persian(text) if is_persian(text) else text


# ---------------------------------------------------------------------------
# ساختن فایل‌ها
# ---------------------------------------------------------------------------

def make_cover(title, author, color):
    """یک جلد PNG ساده: پس‌زمینه‌ی یک‌رنگ، عنوان وسط و نام نویسنده پایین آن."""
    width, height = COVER_SIZE
    image = Image.new("RGB", COVER_SIZE, color)
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(str(FONT_PATH), 60)
    author_font = ImageFont.truetype(str(FONT_PATH), 32)

    # کادر نازک دور جلد
    draw.rectangle([24, 24, width - 25, height - 25], outline="#ffffff", width=3)

    lines = wrap_lines(title, title_font, width - 120)
    line_height = 84
    y = height / 2 - (len(lines) * line_height) / 2 - 40
    for line in lines:
        draw.text((width / 2, y), display(line), font=title_font, fill="#ffffff", anchor="ma")
        y += line_height

    draw.text((width / 2, y + 40), display(author), font=author_font, fill="#f1f1f1", anchor="ma")
    draw.text((width / 2, height - 80), "MegaBook", font=author_font, fill="#ffffffaa", anchor="ma")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def make_placeholder_pdf(lines):
    """یک PDF یک‌صفحه‌ای معتبر و خیلی کوچک، بدون هیچ کتابخانه‌ای.

    PDF از چند «شیء» شماره‌دار ساخته می‌شود (کاتالوگ، فهرست صفحه‌ها، صفحه، محتوا، فونت)
    و در انتها جدول xref می‌گوید هر شیء از کدام بایت فایل شروع می‌شود.
    از فونت استاندارد Helvetica استفاده می‌کنیم که همه‌ی نمایشگرها دارند؛ پس متن انگلیسی است.
    """
    text_ops = ["BT", "/F1 20 Tf", "28 TL", "72 760 Td"]
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        text_ops.append(f"({safe}) Tj T*")
    text_ops.append("ET")
    content = "\n".join(text_ops).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    pdf = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    xref_start = len(pdf)
    pdf += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        pdf += b"%010d 00000 n \n" % offset
    pdf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n" % (len(objects) + 1, xref_start)
    pdf += b"%%EOF\n"
    return pdf


def placeholder_lines(isbn, kind):
    return [
        "MegaBook - sample file",
        f"This is a placeholder {kind}, not real book content.",
        f"ISBN {isbn}",
    ]


# ---------------------------------------------------------------------------
# دستور
# ---------------------------------------------------------------------------

class Command(BaseCommand):
    help = "Adds the sample books from catalog/management/seed_data.py. Safe to run more than once."

    def handle(self, *args, **options):
        admin = get_user_model().objects.filter(is_superuser=True).order_by("id").first()
        if admin is None:
            # عمداً superuser نمی‌سازیم؛ ساختن حساب مدیر و رمزش تصمیم خود تیم است
            raise CommandError(
                "No superuser found. Create one first with: "
                "docker compose exec backend python manage.py createsuperuser"
            )

        self.check_data()
        self.created_names = {"categories": [], "people": [], "publishers": [], "tags": []}
        uploaders = {"admin": admin, "user": self.sample_uploader()}

        for name in CATEGORIES:
            self.get_or_create(Category, "categories", name)

        results = []
        for data in SAMPLE_BOOKS:
            if Book.objects.filter(isbn=data["isbn"]).exists():
                results.append((data, "skipped (ISBN already exists)"))
                continue
            self.create_book(data, uploaders[data.get("uploader", "user")])
            results.append((data, "created"))

        self.report(results, uploaders)

    def sample_uploader(self):
        """The regular (non-staff) account that owns most sample books; created once."""
        user, created = get_user_model().objects.get_or_create(
            email=SAMPLE_UPLOADER_EMAIL,
            defaults={
                "first_name": "بارگذارنده",
                "last_name": "نمونه",
                # make_password(None) = an unusable password: no one can log in as this user
                "password": make_password(None),
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"Created sample uploader: {user}"))
        return user

    def check_data(self):
        """قبل از نوشتن هر چیزی، داده را چک می‌کنیم تا اشتباه تایپی نیمه‌کاره ذخیره نشود."""
        valid_status = set(Book.Status.values)
        for data in SAMPLE_BOOKS:
            label = f"{data['isbn']} ({data['title']})"
            if not (len(data["isbn"]) == 13 and data["isbn"].isdigit() and isbn13_is_valid(data["isbn"])):
                raise CommandError(f"Invalid ISBN-13: {label}")
            if data["category"] not in CATEGORIES:
                raise CommandError(f"Unknown category for {label}: {data['category']}")
            if data["status"] not in valid_status:
                raise CommandError(f"Unknown status for {label}: {data['status']}")
            self.check_money(data, label)

    def check_money(self, data, label):
        # The same rules the model enforces, checked up front so a typo stops the
        # command before anything is written instead of halfway through
        if data.get("uploader", "user") not in ("admin", "user"):
            raise CommandError(f"Unknown uploader for {label}: {data['uploader']}")
        if data.get("uploader") == "admin" and data["seller_share"] != 0:
            raise CommandError(f"Admin-uploaded books have seller_share 0: {label}")
        if data["status"] == "approved":
            if data["price"] is None:
                raise CommandError(f"Approved book without a price: {label}")
            if data["price"] < data["seller_share"]:
                raise CommandError(f"price is less than seller_share: {label}")

    def get_or_create(self, model, bucket, name):
        obj, created = model.objects.get_or_create(name=name)
        if created:
            self.created_names[bucket].append(name)
        return obj

    @transaction.atomic
    def create_book(self, data, uploader):
        # هر کتاب در تراکنش خودش: اگر وسط کار خطا بدهد، نیمه‌کاره در دیتابیس نمی‌ماند
        isbn = data["isbn"]
        book = Book.objects.create(
            title=data["title"],
            original_title=data.get("original_title", ""),
            isbn=isbn,
            language=data["language"],
            publisher=self.get_or_create(Publisher, "publishers", data["publisher"]),
            category=Category.objects.get(name=data["category"]),
            description=data["description"],
            page_count=data["page_count"],
            publication_year=data["publication_year"],
            edition=data.get("edition", ""),
            price=data["price"],
            seller_share=data["seller_share"],
            status=data["status"],
            uploaded_by=uploader,
            # ContentFile فایلِ در حافظه است؛ Django هنگام ذخیره آن را در MEDIA_ROOT/upload_to می‌نویسد
            cover=ContentFile(make_cover(data["title"], data["authors"][0], data["color"]), name=f"{isbn}.png"),
            book_file=ContentFile(make_placeholder_pdf(placeholder_lines(isbn, "book file")), name=f"{isbn}.pdf"),
            sample_file=ContentFile(
                make_placeholder_pdf(placeholder_lines(isbn, "preview file")), name=f"{isbn}-sample.pdf"
            ),
        )
        # روابط چندبه‌چند بعد از ذخیره‌ی کتاب، چون کتاب باید اول id داشته باشد
        book.authors.set([self.get_or_create(Person, "people", n) for n in data["authors"]])
        book.translators.set([self.get_or_create(Person, "people", n) for n in data.get("translators", [])])
        book.tags.set([self.get_or_create(Tag, "tags", n) for n in data["tags"]])
        return book

    def report(self, results, uploaders):
        self.stdout.write("")
        for key, user in uploaders.items():
            self.stdout.write(f"Uploader ({key}): {user} (id={user.id})")
        self.stdout.write("")
        self.stdout.write(f"{'ISBN':<15}{'STATUS':<10}{'UPLOADER':<10}{'PRICE':>9}{'SHARE':>9}  {'RESULT':<32}TITLE")
        self.stdout.write("-" * 110)
        for data, result in results:
            style = self.style.SUCCESS if result == "created" else self.style.WARNING
            price = "-" if data["price"] is None else data["price"]
            self.stdout.write(
                f"{data['isbn']:<15}{data['status']:<10}{data.get('uploader', 'user'):<10}"
                f"{price:>9}{data['seller_share']:>9}  " + style(f"{result:<32}") + data["title"]
            )

        created = sum(1 for _, r in results if r == "created")
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Books created: {created}") + f"   skipped: {len(results) - created}")
        for bucket, names in self.created_names.items():
            shown = ", ".join(names) if names else "-"
            self.stdout.write(f"New {bucket} ({len(names)}): " + textwrap.shorten(shown, 200))
