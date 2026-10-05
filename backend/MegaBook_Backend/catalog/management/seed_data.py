"""داده‌ی نمونه برای دستور seed_books.

این فایل فقط داده است؛ منطق ساختن ردیف‌ها در commands/seed_books.py است.
برای اضافه کردن کتاب، یک دیکشنری دیگر به SAMPLE_BOOKS اضافه کنید.

قرارداد:
- isbn: شابک ۱۳ رقمی همان نسخه‌ای که مشخصاتش آمده (رقم کنترلی هنگام اجرا چک می‌شود).
- publication_year: سالِ چاپ همان نسخه، همان‌طور که روی کتاب آمده؛
  برای ترجمه‌های فارسی سال شمسی، برای کتاب‌های انگلیسی سال میلادی.
- category: نام یکی از CATEGORIES.
- status: یکی از مقادیر Book.Status ("approved" / "pending" / "rejected").
- color: رنگ پس‌زمینه‌ی جلدی که برای کتاب ساخته می‌شود.
"""

# دسته‌بندی‌های فروشگاه. همه ساخته می‌شوند، حتی اگر هنوز کتابی نداشته باشند،
# تا منوی «موضوع» در فرم بارگذاری پر باشد. اگر از قبل وجود داشته باشند، دوباره ساخته نمی‌شوند.
CATEGORIES = [
    "داستان و رمان",
    "سبک زندگی",
    "کودکان",
    "کلاسیک",
    "علمی",
    "تاریخ",
    "روان‌شناسی",
    "فلسفه",
    "کسب‌وکار",
    "شعر",
    "هنر",
]

SAMPLE_BOOKS = [
    # ---------------- کتاب‌های انگلیسی ----------------
    {
        "isbn": "9780060935467",
        "title": "To Kill a Mockingbird",
        "authors": ["Harper Lee"],
        "language": "en",
        "publisher": "Harper Perennial Modern Classics",
        "category": "داستان و رمان",
        "tags": ["برنده جایزه", "پرفروش جهانی", "اقتباس سینمایی", "عدالت"],
        "page_count": 336,
        "publication_year": 2006,
        "price": 185000,
        "status": "approved",
        "color": "#8c4a2f",
        "description": (
            "Told through the eyes of young Scout Finch, this novel follows a small Alabama town "
            "as her father defends a Black man accused of a crime he did not commit. "
            "It is a story about growing up, about courage, and about what a community reveals "
            "when justice is put to the test."
        ),
    },
    {
        "isbn": "9780451524935",
        "title": "1984",
        "authors": ["George Orwell"],
        "language": "en",
        "publisher": "Signet Classic",
        "category": "کلاسیک",
        "tags": ["پادآرمان‌شهری", "کلاسیک قرن بیستم", "اقتباس سینمایی"],
        "page_count": 328,
        "publication_year": 1961,
        "price": 0,  # تنها کتاب رایگان
        "status": "approved",
        "color": "#3b3b3b",
        "description": (
            "Winston Smith rewrites old newspapers at the Ministry of Truth so that history always "
            "agrees with the Party. When he starts a secret diary and falls in love, he learns how far "
            "a state will go to control not only what people do but what they think. "
            "Its warnings about surveillance and propaganda still feel current."
        ),
    },
    {
        "isbn": "9780743269513",
        "title": "The 7 Habits of Highly Effective People",
        "authors": ["Stephen R. Covey"],
        "language": "en",
        "publisher": "Free Press",
        "category": "سبک زندگی",
        "tags": ["خودیاری", "توسعه فردی", "موفقیت"],
        "page_count": 372,
        "publication_year": 2004,
        "price": 150000,
        "status": "approved",
        "color": "#1f5f8b",
        "description": (
            "Covey argues that lasting effectiveness grows out of character rather than quick techniques. "
            "The book moves from personal habits, such as taking responsibility and putting first things first, "
            "to the habits that help people work well with others."
        ),
    },
    {
        "isbn": "9780735211292",
        "title": "Atomic Habits",
        "authors": ["James Clear"],
        "language": "en",
        "publisher": "Avery",
        "category": "سبک زندگی",
        "tags": ["خودیاری", "توسعه فردی", "عادت", "پرفروش جهانی"],
        "page_count": 320,
        "publication_year": 2018,
        "price": 245000,
        "status": "pending",  # برای تست: فروشگاه نباید این را نشان دهد
        "color": "#d9a21b",
        "description": (
            "Clear shows how tiny changes, repeated every day, add up to remarkable results over time. "
            "He offers a practical framework for building good habits and breaking bad ones "
            "by redesigning your environment and the way you see yourself."
        ),
    },
    {
        "isbn": "9780553380163",
        "title": "A Brief History of Time",
        "authors": ["Stephen Hawking"],
        "language": "en",
        "publisher": "Bantam",
        "category": "علمی",
        "tags": ["علوم برای همه", "فیزیک", "پرفروش جهانی"],
        "page_count": 212,
        "publication_year": 1998,
        "edition": "Tenth Anniversary Edition",
        "price": 165000,
        "status": "approved",
        "color": "#14213d",
        "description": (
            "Hawking takes readers from the Big Bang to black holes and explains how space and time behave "
            "without leaning on equations. This anniversary edition updates the original text with discoveries "
            "made in the decade after it first appeared."
        ),
    },
    {
        "isbn": "9780590353427",
        "title": "Harry Potter and the Sorcerer's Stone",
        "authors": ["J.K. Rowling"],
        "language": "en",
        "publisher": "Scholastic",
        "category": "کودکان",
        "tags": ["فانتزی", "اقتباس سینمایی", "پرفروش جهانی"],
        "page_count": 309,
        "publication_year": 1998,
        "price": 210000,
        "status": "rejected",  # برای تست: فروشگاه نباید این را نشان دهد
        "color": "#7a1f2b",
        "description": (
            "On his eleventh birthday Harry Potter learns that he is a wizard and is invited to Hogwarts "
            "School of Witchcraft and Wizardry. There he finds loyal friends, a place where he belongs, "
            "and the first clues about the dark wizard who changed his life."
        ),
    },
    # ---------------- ترجمه‌های فارسی ----------------
    {
        "isbn": "9789643510138",
        "title": "شازده کوچولو",
        "original_title": "Le Petit Prince",
        "authors": ["آنتوان دو سنت‌اگزوپری"],
        "translators": ["احمد شاملو"],
        "language": "fa",
        "publisher": "نگاه",
        "category": "کودکان",
        "tags": ["کلاسیک قرن بیستم", "فلسفی", "اقتباس سینمایی"],
        "page_count": 103,
        "publication_year": 1405,
        "price": 45000,
        "status": "approved",
        "color": "#2a9d8f",
        "description": (
            "خلبانی که در صحرا گرفتار شده، با شازده کوچولویی آشنا می‌شود که از سیاره‌ای کوچک آمده است. "
            "این داستان کوتاه با زبانی ساده از دوستی، مسئولیت و چیزهایی می‌گوید که فقط با دل دیده می‌شوند. "
            "ترجمه‌ی شاملو این اثر را برای چند نسل از خوانندگان فارسی‌زبان به خاطره‌ای ماندگار تبدیل کرده است."
        ),
    },
    {
        "isbn": "9786003246294",
        "title": "کیمیاگر",
        "original_title": "O Alquimista",
        "authors": ["پائولو کوئیلو"],
        "translators": ["مهتاب غرار"],
        "language": "fa",
        "publisher": "تیرگان",
        "category": "داستان و رمان",
        "tags": ["پرفروش جهانی", "فلسفی", "ادبیات آمریکای لاتین"],
        "page_count": 200,
        "publication_year": 1402,
        "price": 95000,
        "status": "approved",
        "color": "#c26a1b",
        "description": (
            "سانتیاگو، چوپان جوانی از اسپانیا، به دنبال گنجی که در خواب دیده، راهی صحرای مصر می‌شود. "
            "او در این سفر می‌آموزد که گوش دادن به دل و دنبال کردن رؤیا، خودش بخشی از همان گنج است."
        ),
    },
    {
        "isbn": "9789640013830",
        "title": "صد سال تنهایی",
        "original_title": "Cien años de soledad",
        "authors": ["گابریل گارسیا مارکز"],
        "translators": ["بهمن فرزانه"],
        "language": "fa",
        "publisher": "امیرکبیر",
        "category": "کلاسیک",
        "tags": ["برنده جایزه", "رئالیسم جادویی", "ادبیات آمریکای لاتین", "کلاسیک قرن بیستم"],
        "page_count": 462,
        "publication_year": 1403,
        "price": 280000,
        "status": "approved",
        "color": "#5a3e85",
        "description": (
            "این رمان سرگذشت هفت نسل از خانواده‌ی بوئندیا را در دهکده‌ی خیالی ماکوندو روایت می‌کند. "
            "مارکز واقعیت و خیال را چنان در هم می‌آمیزد که شگفت‌انگیزترین اتفاق‌ها هم طبیعی به نظر می‌رسند. "
            "ترجمه‌ی بهمن فرزانه نخستین ترجمه‌ی فارسی این اثر است."
        ),
    },
    {
        "isbn": "9786008547037",
        "title": "انسان خردمند",
        "original_title": "Sapiens: A Brief History of Humankind",
        "authors": ["یووال نوح هراری"],
        "translators": ["نیک گرگین"],
        "language": "fa",
        "publisher": "فرهنگ نشر نو",
        "category": "علمی",
        "tags": ["پرفروش جهانی", "تاریخ", "علوم برای همه"],
        "page_count": 624,
        "publication_year": 1404,
        "price": 320000,
        "status": "approved",
        "color": "#386641",
        "description": (
            "هراری تاریخ گونه‌ی ما را از پیدایش انسان خردمند تا امروز در یک روایت پیوسته بازگو می‌کند. "
            "او نشان می‌دهد که انقلاب‌های شناختی، کشاورزی و علمی چگونه جامعه و زندگی روزمره‌ی انسان را شکل داده‌اند."
        ),
    },
]
