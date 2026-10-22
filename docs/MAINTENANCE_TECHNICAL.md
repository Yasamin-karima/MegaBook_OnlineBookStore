# راهنمای فنی مگابوک

> بخش ۲ از راهنمای نگهداری. برای توسعه‌دهنده‌ها و DevOps.
> بخش عمومی (نقش‌ها، مسیرهای کاربر، کارهای ادمین): [راهنمای عمومی](MAINTENANCE_GENERAL.md)
> چرایی تصمیم‌ها: [`DECISIONS.md`](../DECISIONS.md). شماره‌هایی مثل «DECISIONS ۶.۷» به بخش‌های همان سند اشاره می‌کنند.

همهٔ مسیرهای فایل نسبت به ریشهٔ مخزن‌اند. پروژهٔ Django در `backend/MegaBook_Backend/` است و پروژهٔ React در `frontend/MegaBook_frontend/`.

---

## ۱. معماری

```
مرورگر ──(HTTP، JWT در هدر)──► backend: Django + DRF   :8000 ──► db: PostgreSQL 16  :5432
   │                                    │
   └──► frontend: Vite dev server :5173 └──(HTTPS)──► openlibrary.org / covers.openlibrary.org / *.archive.org
```

| سرویس (`docker-compose.yml`) | ایمیج | پورت میزبان:کانتینر | فرمان | volume |
|---|---|---|---|---|
| `db` | `postgres:16` | `5432:5432` | پیش‌فرض ایمیج | `postgres_data` (volume نام‌دار) ← `/var/lib/postgresql/data/` |
| `backend` | build از `backend/MegaBook_Backend` (`python:3.12-slim`) | `8000:8000` | `python manage.py runserver 0.0.0.0:8000` | `./backend/MegaBook_Backend` ← `/app` |
| `frontend` | build از `frontend/MegaBook_frontend` (`node:20-alpine`) | `5173:5173` | `npm run dev -- --host` | `./frontend/MegaBook_frontend` ← `/app`، و `/app/node_modules` (volume ناشناس) |

ارتباط‌ها:
- **فرانت و بک‌اند** دو origin جدا هستند. مرورگر مستقیم به `http://localhost:8000` درخواست می‌دهد (ثابت در `frontend/MegaBook_frontend/src/api/client.js`) و CORS با `django-cors-headers` باز شده است.
- **احراز هویت** JWT است (`djangorestframework-simplejwt`): access با عمر ۳۰ دقیقه و refresh با عمر ۷ روز. فرانت توکن‌ها را در `localStorage` نگه می‌دارد (`access_token` و `refresh_token`). وقتی پاسخ 401 بیاید، `client.js` یک بار با refresh توکن تازه می‌گیرد و درخواست را تکرار می‌کند. Blacklist روشن است، پس logout و تغییر رمز refresh را باطل می‌کنند (DECISIONS ۲.۱۳، ۲.۱۴).
- **پنل ادمین Django** (`/admin/`) با session و cookie کار می‌کند، نه JWT.
- **بک‌اند و دیتابیس:** بک‌اند با نام سرویس `db` در شبکهٔ Compose به Postgres وصل می‌شود (`POSTGRES_HOST`).
- **Open Library** فقط از بک‌اند صدا زده می‌شود، هرگز از مرورگر (DECISIONS ۴.۲).

هیچ صف کار (worker)، cache مشترک، Redis، یا ارسال ایمیل و پیامک واقعی وجود ندارد.

---

## ۲. وابستگی‌ها

### ۲.۱ بک‌اند (`backend/MegaBook_Backend/requirements.txt`)

> ⚠️ **فقط ۴ پکیج نسخهٔ ثابت دارند.** بقیه بدون نسخه‌اند و با هر `docker compose build` ممکن است نسخهٔ تازه‌تری نصب شود. ستون «نصب‌شده» از `pip freeze` کانتینر در حال اجرا (مهر ۱۴۰۵) است. پیشنهاد: همین نسخه‌ها را در `requirements.txt` ثابت کنید.

| پکیج | در `requirements.txt` | نصب‌شده | کاربرد |
|---|---|---|---|
| `Django` | `==6.1` | 6.1 | فریم‌ورک اصلی |
| `asgiref` | `==3.12.1` | 3.12.1 | وابستگی Django |
| `sqlparse` | `==0.6.0` | 0.6.0 | وابستگی Django |
| `tzdata` | `==2026.3` | 2026.3 | منطقه‌های زمانی |
| `djangorestframework` | پین نشده | 3.18.3 | API |
| `djangorestframework-simplejwt` | پین نشده | 5.5.1 | JWT و blacklist توکن |
| `django-cors-headers` | پین نشده | 4.9.0 | CORS |
| `psycopg2-binary` | پین نشده | 2.9.13 | درایور PostgreSQL |
| `python-decouple` | پین نشده | 3.8 | خواندن `.env` |
| `pillow` | پین نشده | 12.3.0 | بررسی تصویر، ساخت جلد در `seed_books` |
| `requests` | پین نشده | 2.34.2 | تماس با Open Library |

وابستگی‌های غیرمستقیم نصب‌شده: `PyJWT 2.15.1`، `urllib3 2.8.0`، `certifi`، `idna`، `charset-normalizer`.

برای دیدن نسخه‌های واقعی:

```bash
docker compose exec backend pip freeze
```

### ۲.۲ فرانت (`frontend/MegaBook_frontend/package.json`)

`package.json` بازه با `^` دارد. نسخهٔ دقیق از `package-lock.json` می‌آید و `npm install` در Dockerfile آن را رعایت می‌کند.

| پکیج | بازه | نسخهٔ lock | نوع |
|---|---|---|---|
| `react` / `react-dom` | `^19.2.8` | 19.2.8 | dependency |
| `react-router-dom` | `^7.18.3` | 7.18.3 | dependency |
| `axios` | `^1.20.0` | 1.20.0 | dependency |
| `react-icons` | `^5.7.0` | 5.7.0 | dependency |
| `tailwindcss` / `@tailwindcss/vite` | `^4.3.3` | 4.3.3 | dependency |
| `vite` | `^8.2.2` | 8.2.2 | dev |
| `@vitejs/plugin-react` | `^6.1.0` | 6.1.1 | dev |
| `oxlint` | `^1.79.0` | 1.80.0 | dev (lint) |
| `@types/react` / `@types/react-dom` | `^19.2.18` / `^19.2.4` | — | dev |

اسکریپت‌ها: `dev`، `build`، `lint` (oxlint با `.oxlintrc.json`) و `preview`. فونت Vazirmatn در خود مخزن است (`src/assets/fonts/`).

### ۲.۳ سرویس بیرونی: Open Library

| کار | آدرس | مهلت | اگر در دسترس نبود |
|---|---|---|---|
| مشخصات شابک | `https://openlibrary.org/api/books` (بدون کلید API) | ۵ ثانیه برای اتصال و ۵ ثانیه برای خواندن | `GET /catalog/isbn-lookup/` پاسخ **502** با پیام فارسی می‌دهد. فرم بارگذاری و صفحهٔ درخواست اجازه می‌دهند مشخصات دستی وارد شود. وضعیت شابک در مگابوک (`already_exists` و...) در پاسخ 502 هم برمی‌گردد. |
| دانلود جلد | شروع از `https://covers.openlibrary.org`، تغییر مسیر فقط به `archive.org` و زیردامنه‌هایش | کل دانلود ۱۰ ثانیه، حداکثر ۵ MB، حداکثر ۵ redirect | ساخت کتاب با خطای «جلد کتاب دریافت نشد؛ لطفاً تصویر را خودتان بارگذاری کنید» رد می‌شود و هیچ چیزی ذخیره نمی‌شود. |

اگر شابک پیدا نشود، پاسخ 404 است. دانلود جلد در برابر SSRF سخت‌گیر است: فقط HTTPS، فهرست مجاز میزبان‌ها، redirect دستی و بررسی هر قدم، و بررسی تصویر با Pillow (DECISIONS ۴.۱۶، ۴.۱۷). کد این بخش در `catalog/book_sources/openlibrary.py` است. برای افزودن منبع دوم، راهنمای docstring فایل `catalog/book_sources/__init__.py` را ببینید.

بک‌اند برای این تماس‌ها به اینترنت خروجی نیاز دارد. **[جای خالی: آیا سرور واقعی به openlibrary.org دسترسی دارد یا پشت فیلتر یا proxy است؟]**

---

## ۳. پیکربندی

### ۳.۱ متغیرهای `.env`

فایل `backend/MegaBook_Backend/.env` در git نیست (`.gitignore`) و Compose آن را با `env_file` به **هر دو** سرویس `db` و `backend` می‌دهد. Postgres از `POSTGRES_DB`، `POSTGRES_USER` و `POSTGRES_PASSWORD` همین فایل، دیتابیس و کاربر را **فقط بار اول** (وقتی volume خالی است) می‌سازد.

| متغیر | اجباری | پیش‌فرض | کاربرد |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | ✅ | — | `SECRET_KEY`. امضای JWT و امضای لینک فایل‌های خصوصی هم به آن وابسته‌اند. **عوض کردنش همهٔ کاربران را خارج می‌کند و همهٔ لینک‌های دانلود را باطل می‌کند.** کلید قدیمی‌ای که در تاریخچهٔ git هست سوخته حساب می‌شود (DECISIONS ۶.۱۲). |
| `DJANGO_DEBUG` | — | `False` | برای توسعه `True`. با `False`، شارژ ماک 404 می‌دهد و `/media/` سرو نمی‌شود. |
| `DJANGO_ALLOWED_HOSTS` | با `DEBUG` خاموش | `localhost,127.0.0.1` | نام‌های میزبان مجاز، جداشده با کاما. |
| `POSTGRES_DB` | ✅ | — | نام دیتابیس |
| `POSTGRES_USER` | ✅ | — | کاربر دیتابیس |
| `POSTGRES_PASSWORD` | ✅ | — | رمز دیتابیس |
| `POSTGRES_HOST` | ✅ | — | در Compose: `db` |
| `POSTGRES_PORT` | ✅ | — | معمولاً `5432` |
| `MEGABOOK_CARD_NUMBER` | — | خالی | کارت مگابوک برای شارژ کارت‌به‌کارت. اگر خالی باشد، `GET /wallet/` مقدار `topup_card: null` برمی‌گرداند و صفحه کاربر را به پشتیبانی می‌فرستد. |
| `MEGABOOK_CARD_HOLDER` | — | خالی | نام صاحب کارت |
| `PRIVATE_MEDIA_ACCEL_PREFIX` | — | خالی | در production پشت nginx، مثلاً `/protected/` (بخش ۸). |

نمونهٔ `.env` برای توسعه (این مقدارها را روی سرور واقعی به کار نبرید):

```env
POSTGRES_DB=megabook
POSTGRES_USER=megabook
POSTGRES_PASSWORD=change-me
POSTGRES_HOST=db
POSTGRES_PORT=5432
DJANGO_SECRET_KEY=یک-رشتهٔ-تصادفی-طولانی
DJANGO_DEBUG=True
MEGABOOK_CARD_NUMBER=
MEGABOOK_CARD_HOLDER=
```

یک کلید تازه این‌طور ساخته می‌شود:

```bash
docker compose exec backend python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"
```

### ۳.۲ تنظیم‌های ثابت در `settings.py` که باید بشناسید

| تنظیم | مقدار | نکته |
|---|---|---|
| `AUTH_USER_MODEL` | `accounts.Account` | مدل کاربر سفارشی، بدون `username` |
| `AUTHENTICATION_BACKENDS` | `accounts.backends.IdentifierBackend` | ورود با ایمیل یا موبایل، هم در API و هم در پنل ادمین |
| `CORS_ALLOWED_ORIGINS` | `localhost:5173`، `127.0.0.1:5173`، `localhost:8000` | **ثابت در کد.** برای دامنهٔ واقعی باید عوض شود. |
| `REST_FRAMEWORK` | احراز هویت JWT، اجازهٔ پیش‌فرض `AllowAny` | هر view اجازهٔ خودش را تعیین می‌کند. صفحه‌بندی سراسری نداریم و هر view صفحه‌بندی خودش را دارد. |
| `DEFAULT_THROTTLE_RATES` | `support_messages: 10/min` | فقط برای ارسال پیام پشتیبانی. شمارش در LocMemCache است، یعنی جدا برای هر پروسه. |
| `SIMPLE_JWT` | access ۳۰ دقیقه، refresh ۷ روز، `UPDATE_LAST_LOGIN` | |
| `MEDIA_ROOT` / `MEDIA_URL` | `media/` و `/media/` | جلد و فایل نمونه (عمومی) |
| `PRIVATE_MEDIA_ROOT` | `private_media/` | فایل کامل کتاب و رسید شارژ (خصوصی) |
| `PRIVATE_FILE_LINK_SECONDS` | `300` | عمر لینک امضاشدهٔ دانلود |
| `TEST_RUNNER` | `MegaBook_Backend.test_runner.TempPrivateMediaRunner` | تست‌ها `private_media` را در یک پوشهٔ موقت می‌گذارند. |
| `MAILERS` | console backend | ایمیلی فرستاده نمی‌شود و فقط در log چاپ می‌شود. |
| `LANGUAGE_CODE` / `TIME_ZONE` | `en-us` / `UTC` | زمان‌ها UTC ذخیره می‌شوند و فرانت آن‌ها را به وقت محلی نشان می‌دهد. |
| `STATIC_URL` | `static/` | **`STATIC_ROOT` تعریف نشده** (بخش ۱۲). |

### ۳.۳ چیزهایی که فقط با `DEBUG=True` کار می‌کنند

- `POST /wallet/mock-topup/` (درگاه ماک). بررسی در `wallet/gateways/__init__.py` و در `dispatch` انجام می‌شود، پس با `DEBUG` خاموش پاسخ 404 است، پیش از هر بررسی دیگری.
- سرو شدن `/media/` توسط خود Django (`urlpatterns += static(...)` در `MegaBook_Backend/urls.py`).
- صفحهٔ خطای جزئی Django.

---

## ۴. اجرا

همهٔ دستورها از **ریشهٔ مخزن** اجرا می‌شوند.

### ۴.۱ راه‌اندازی بار اول

```bash
# 1. ساختن .env (بخش ۳.۱)
#    backend/MegaBook_Backend/.env

# 2. ساختن و بالا آوردن هر سه سرویس
docker compose up --build -d

# 3. ساختن جدول‌ها (خودکار اجرا نمی‌شود)
docker compose exec backend python manage.py migrate

# 4. ساختن مدیر کل (ایمیل، نام، نام خانوادگی و رمز را می‌پرسد)
docker compose exec backend python manage.py createsuperuser

# 5. (اختیاری) دادهٔ نمونه: ۱۱ موضوع و ۱۰ کتاب
docker compose exec backend python manage.py seed_books
```

بعد از این:
- سایت در `http://localhost:5173` باز می‌شود.
- API در `http://localhost:8000` است.
- پنل ادمین در `http://localhost:8000/admin/` است.

### ۴.۲ کارهای روزمره

| کار | دستور |
|---|---|
| بالا آوردن | `docker compose up -d` |
| خاموش کردن | `docker compose down` (دیتابیس در volume می‌ماند) |
| پاک کردن دیتابیس هم | `docker compose down -v` ⚠️ **همهٔ داده پاک می‌شود** |
| دیدن log | `docker compose logs -f backend` (یا `frontend`، `db`) |
| ساختن دوبارهٔ کانتینرها (بعد از تغییر `requirements.txt`، `package.json` یا Dockerfile) | `docker compose up --build -d` |
| اعمال تغییر `.env` | `docker compose up -d` (کانتینر از نو ساخته می‌شود؛ `restart` کافی نیست) |
| ساختن migration بعد از تغییر مدل | `docker compose exec backend python manage.py makemigrations` |
| اجرای migrationها | `docker compose exec backend python manage.py migrate` |
| shell جنگو | `docker compose exec backend python manage.py shell` |
| shell دیتابیس | `docker compose exec db psql -U <POSTGRES_USER> <POSTGRES_DB>` |
| اجرای تست‌ها | `docker compose exec backend python manage.py test` |
| تست یک اپ | `docker compose exec backend python manage.py test wallet` |
| lint فرانت | `docker compose exec frontend npm run lint` |
| بررسی تنظیمات جنگو | `docker compose exec backend python manage.py check` |

کد هر دو سرویس با volume به کانتینر وصل است. تغییر کد پایتون با reload خودکار `runserver` اثر می‌کند و تغییر React با HMR خود Vite (`CHOKIDAR_USEPOLLING` برای ویندوز روشن است). فقط تغییر وابستگی‌ها build دوباره می‌خواهد.

تست‌ها به **PostgreSQL** نیاز دارند. بعضی تست‌ها هم‌زمانی را با `TransactionTestCase` و threadهای واقعی می‌سنجند و روی SQLite معنا ندارند. Django خودش یک دیتابیس `test_<POSTGRES_DB>` می‌سازد، پس کاربر Postgres باید اجازهٔ `CREATEDB` داشته باشد. کاربری که ایمیج رسمی Postgres از `.env` می‌سازد این اجازه را دارد.

### ۴.۳ دستورهای مدیریتی پروژه

| دستور | کار | تکرارپذیر؟ |
|---|---|---|
| `seed_books` | ۱۱ موضوع و ۱۰ کتاب نمونه از `catalog/management/seed_data.py` می‌سازد. جلد را با Pillow می‌سازد و فایل‌ها PDF کوچک «نمونه» هستند، پس به اینترنت نیازی ندارد. کتاب‌های `uploader: "admin"` به اولین superuser داده می‌شوند و بقیه به کاربر `sample-uploader@megabook.invalid` (رمز غیرقابل‌استفاده؛ هیچ‌کس نمی‌تواند با آن وارد شود). **بدون superuser خطا می‌دهد.** | ✅ کتابی که شابکش هست رد می‌شود و هیچ داده‌ای ویرایش نمی‌شود. |
| `fulfil_requests_on_sale [--dry-run]` | درخواست‌های بازی را که کتاب تأییدشده با همان شابک دارند «تأمین شده» می‌کند. برای داده‌ای است که پیش از همگام‌سازی خودکار (DECISIONS ۵.۱۴) ساخته شده. هر ردیف از `save()` رد می‌شود، پس پیام سیستمی هم فرستاده می‌شود. | ✅ |

---

## ۵. اپ‌ها و مدل داده

### ۵.۱ نقشهٔ اپ‌ها

| اپ | مدل‌ها | کار |
|---|---|---|
| `accounts` | `Account` | کاربر، ثبت‌نام، ورود، پروفایل، تغییر رمز |
| `catalog` | `Book`، `Person`، `Publisher`، `Category`، `Tag` | کتاب، بارگذاری، جستجوی شابک، فایل خصوصی کتاب، «مالکیت» |
| `book_requests` | `BookRequest`، `RequestEntry` | درخواست کتاب با شابک |
| `wallet` | `Wallet`، `LedgerEntry`، `TopUpRequest`، `WithdrawalRequest`، `GatewayPayment` | دفتر پول، شارژ، برداشت، اصلاح دستی |
| `cart` | `CartItem` | سبد خرید روی سرور |
| `orders` | `Order`، `OrderItem` | خرید (checkout) و رسید |
| `library` | `LibraryItem` | کتاب‌هایی که کاربر دارد |
| `dashboard` | بدون مدل | خلاصه‌ها و فهرست‌های پیگیری؛ فقط می‌خواند |
| `support` | `Conversation`، `Message` | گفت‌وگوی کاربر با پشتیبانی |
| `MegaBook_Backend` | — | settings، urls، `private_files.py`، `test_runner.py` |

جهت وابستگی: `accounts` ← `catalog` ← `book_requests` / `wallet` ← `cart` / `orders` / `library` ← `support` ← `dashboard`. اپ‌های پایین‌تر هرگز در سطح ماژول اپ‌های بالاتر را import نمی‌کنند. جاهایی مثل `Book.save()` که لازم است، import را داخل تابع انجام می‌دهند.

### ۵.۲ الگوی مشترک: قاعده‌ها در `save()`، و قید دیتابیس به‌عنوان لایهٔ آخر

Django متد `clean()` را فقط از فرم‌ها (از جمله پنل ادمین) صدا می‌زند، نه از `save()` معمولی. برای همین قاعده‌ها در یک متد جدا هستند که **هم `clean()` و هم `save()`** آن را صدا می‌زنند (DECISIONS ۵.۵):

| مدل | متد | قاعده |
|---|---|---|
| `Account` | `normalize_fields()` | trim کردن نام‌ها؛ ایمیل با حروف کوچک یا `NULL`؛ موبایل به شکل `09xxxxxxxxx` یا `NULL`؛ دست‌کم یکی از ایمیل و موبایل |
| `Book` | `apply_money_rules()` | کتاب تأییدشده قیمت دارد و `price >= seller_share` |
| `BookRequest` | `apply_status_rules()` | «رد شده» دلیل اجباری دارد؛ در وضعیت‌های دیگر دلیل پاک می‌شود |
| `TopUpRequest` | `apply_rules()` | نرمال‌سازی شمارهٔ پیگیری، زمان واریز در آینده نباشد، رد با دلیل |
| `WithdrawalRequest` | `apply_rules()` | نرمال‌سازی و بررسی Luhn کارت |
| `ReviewedRequest` (پایهٔ دو مدل قبل) | `save()` | وضعیت نهایی عوض نمی‌شود |

`QuerySet.update()`، `bulk_create` و SQL مستقیم از `save()` **رد می‌شوند**. برای همین مهم‌ترین قاعده‌ها یک `CheckConstraint` یا `UniqueConstraint` در خود دیتابیس هم دارند (مثلاً `approved_book_price_covers_seller_share`، `book_request_rejection_reason_matches_status`). ولی **اثرهای جانبی** `save()` (پیام سیستمی، همگام شدن درخواست با کتاب) با `update()` اصلاً اجرا نمی‌شوند. بخش ۹.۵ را ببینید.

نرمال‌سازی‌ها هر کدام فقط یک جا تعریف شده‌اند:

| داده | فایل | شکل ذخیره |
|---|---|---|
| موبایل | `accounts/phone.py` | `09` + نُه رقم. ورودی می‌تواند `+98`، `0098`، `98`، `9...`، رقم فارسی یا عربی، فاصله یا خط تیره داشته باشد. |
| شابک | `catalog/isbn.py` | ۱۳ رقم. ISBN-10 تبدیل می‌شود، رقم کنترلی بررسی می‌شود، رقم فارسی، خط تیره و فاصله قبول است. |
| شمارهٔ پیگیری و کارت | `wallet/normalize.py` | پیگیری: رقم و حرف لاتین بزرگ، حداکثر ۵۰. کارت: ۱۶ رقم با Luhn. |

> یک استثنا: `BookCreateSerializer.validate_isbn` فقط شابک **۱۳ رقمی** می‌پذیرد (فاصله و `-` حذف می‌شود)، چون فرم بارگذاری همیشه شکل ۱۳ رقمی را از جستجو می‌فرستد. جستجوی شابک و ثبت درخواست `normalize_isbn` کامل را به کار می‌برند.

### ۵.۳ `accounts`

- `Account(AbstractUser)` بدون `username` است. `USERNAME_FIELD = "email"` و `REQUIRED_FIELDS = ["first_name", "last_name"]`.
- `email` و `phone` هر دو `unique` و `null=True` هستند. مقدار خالی همیشه `NULL` است، نه `""` (DECISIONS ۲.۵). قیدهای `account_*` در Meta همین قاعده‌ها را در دیتابیس هم نگه می‌دارند.
- **superuser و staff حتماً ایمیل دارند**، چون `createsuperuser` و ورود به پنل ادمین بر اساس ایمیل‌اند. `AccountUpdateSerializer` هم اجازه نمی‌دهد staff ایمیلش را حذف کند.
- `IdentifierBackend`: اگر ورودی `@` داشته باشد ایمیل حساب می‌شود، وگرنه موبایل. در برابر timing attack محافظت شده و برای همهٔ شکست‌ها یک پیام دارد.
- عوض کردن ایمیل یا موبایل در `PATCH /accounts/me/` به `current_password` نیاز دارد.
- `POST /accounts/me/password/` همهٔ `OutstandingToken`های کاربر را blacklist می‌کند و جفت توکن تازه برمی‌گرداند.
- ساخته شدن هر کاربر با سیگنال `post_save` در `wallet/signals.py` برایش کیف پول می‌سازد (DECISIONS ۶.۵).

### ۵.۴ `catalog`

- `Book.status` یکی از `pending`، `approved` یا `rejected` است. قید `unique_isbn_unless_rejected` یک partial unique index است: برای هر شابک حداکثر یک کتاب «رد نشده». کتاب ردشده را می‌شود دوباره بارگذاری کرد (DECISIONS ۳.۱۰). `Book.active_for_isbn()` تنها تعریف «این شابک در مگابوک هست؟» است.
- **پول:** `price` (`null` یعنی هنوز تعیین نشده و فقط پیش از تأیید مجاز است) و `seller_share`. `commission` یک property است: `price - seller_share`. ذخیره نمی‌شود.
- **بارگذاری** (`BookCreateSerializer`):
  - کاربر عادی فقط `seller_share` می‌فرستد و `price` برایش read-only است.
  - staff فقط `price` می‌فرستد. `seller_share=0` و `status=approved` همان لحظه تنظیم می‌شوند.
  - جلد یا فایل است (`cover`) یا آدرس (`cover_url`) که بک‌اند دانلودش می‌کند. یکی از این دو اجباری است. فرمت JPG یا PNG و حجم کمتر از ۵ MB.
  - `book_file` و `sample_file` هر دو با پسوند **و** امضای `%PDF-` بررسی می‌شوند.
  - کل ساخت در یک `transaction.atomic()` است.
- **اثر جانبی `Book.save()`:** اگر وضعیت عوض شود (یا کتاب از اول تأییدشده ساخته شود):
  1. `book_requests.services.sync_with_book`: درخواست باز همان شابک «تأمین شده» می‌شود. اگر کتاب از حالت تأییدشده خارج شود و کتاب تأییدشدهٔ دیگری با همان شابک نباشد، درخواست دوباره باز می‌شود. درخواست «رد شده» هرگز دست نمی‌خورد.
  2. `support.services.on_book_status_changed`: برای تأیید و رد، پیام سیستمی برای بارگذارنده.
- **مالکیت** (`catalog/ownership.py`، تنها تعریف): کاربر کتابی را «دارد» که خودش بارگذاری کرده یا در `LibraryItem` دارد. `is_owned` در API، قاعده‌های سبد، checkout و `can_download_file` همه از همین استفاده می‌کنند.
- **`Book.can_download_file(user)`:**
  - staff: همیشه.
  - بارگذارنده: فقط وقتی کتاب `approved` باشد.
  - خریدار: همیشه، حتی اگر کتاب بعداً از فروشگاه برداشته شود.
- **Serializerهای عمومی** (`BookListSerializer`، `BookDetailSerializer`) فهرست صریح فیلد دارند و هرگز `book_file` یا `seller_share` در آن‌ها نیست. **هرگز `fields = "__all__"` ننویسید** (DECISIONS ۳.۸).
- `PROTECT`: کتاب فروخته‌شده (`OrderItem`)، کتابی که در کتابخانهٔ کسی است، و کاربری که کتاب بارگذاری کرده، پاک نمی‌شوند.

### ۵.۵ `book_requests`

- `BookRequest`: یکی برای هر شابک (`isbn` یکتا)، با `status` یکی از `open`، `fulfilled` یا `rejected` و یک `rejection_reason`.
- `RequestEntry`: یک ردیف برای هر کاربر درخواست‌کننده، با قید یکتای `(request, requester)` و `notes` همان کاربر.
- `services.submit_request` به این ترتیب بررسی می‌کند (همه در یک تراکنش، با `select_for_update` روی `BookRequest`):
  1. کتاب تأییدشده با این شابک هست ← `available`
  2. کتاب در انتظار بررسی است ← `in_review`
  3. درخواست قبلاً رد شده ← `rejected`
  4. همین کاربر قبلاً درخواست داده ← `already_requested`
  5. در غیر این صورت `requested`، با پاسخ یکسان چه درخواست تازه باشد چه پیوستن به درخواست موجود، تا کسی نفهمد دیگران هم این کتاب را خواسته‌اند.
- «من هم می‌خواهم» (`/join/`) همین تابع را با `require_open=True` صدا می‌زند.
- `BookRequest.save()` با تغییر وضعیت `support.services.on_request_status_changed` را صدا می‌زند: به هر درخواست‌کننده در گفت‌وگوی خودش پیام سیستمی می‌رود. با «تأمین شده»، گفت‌وگوها خودکار بسته می‌شوند و با خروج از آن دوباره باز می‌شوند.
- در پنل ادمین `BookRequest` و `RequestEntry` حذف‌شدنی نیستند و `RequestEntry` کاملاً read-only است.
- لیست عمومی فقط درخواست‌های `open` را نشان می‌دهد و هیچ اطلاعاتی از درخواست‌کننده‌ها ندارد. `requester_count`، `is_mine` و `book_in_review` با annotate در یک query حساب می‌شوند.

### ۵.۶ `wallet`: دفتر تغییرناپذیر

- **ستون موجودی وجود ندارد.** موجودی برابر `SUM(amount)` تراکنش‌های کیف پول است (`services.balance_of`).
- `Wallet`: یکی برای هر کاربر (`kind=user`، `OneToOne` با `owner`)، به‌اضافهٔ **دقیقاً یک** کیف پول مگابوک (`kind=platform`، بدون owner). کیف پول مگابوک با data migration `wallet/0002` ساخته می‌شود و `platform_wallet()` اگر نباشد آن را می‌سازد.
- `LedgerEntry` تغییرناپذیر است: `save()` روی ردیف موجود، `delete()`، و `update()` و `delete()` روی QuerySet همه `ImmutableLedgerError` می‌دهند. اشتباه با تراکنش جبرانی (`adjustment`) درست می‌شود.

| `type` | علامت | پیوند اجباری |
|---|---|---|
| `topup` | + | دقیقاً یکی از `topup_request` یا `gateway_payment` (هر کدام یکتا ← هر شارژ فقط یک بار) |
| `purchase` | − | `order` و `group` (یکتا برای هر order) |
| `sale_income` | + | `order_item` و `group` |
| `commission` | + (به کیف پول مگابوک) | `order_item` و `group` |
| `withdrawal` | − | `withdrawal_request` |
| `withdrawal_reversal` | + | `withdrawal_request` |
| `adjustment` | ± | `created_by` (ادمین) و `description` غیرخالی |

همهٔ این قاعده‌ها `CheckConstraint` یا `UniqueConstraint` در Meta هم دارند.

- **تنها کدی که `LedgerEntry` می‌سازد `wallet/services.py` است.** یک تست کل پروژه را برای این بررسی می‌کند (DECISIONS ۶.۷). الگوی هر تابع: `atomic` ← قفل ردیف کیف پول‌ها با `select_for_update` **به ترتیب id** ← خواندن موجودی **بعد از** قفل ← بررسی قاعده ← ساخت تراکنش. موجودی کیف پول کاربر هرگز منفی نمی‌شود، ولی کیف پول مگابوک از این قاعده معاف است. این قاعده **فقط در سرویس** است و هیچ قید دیتابیسی ندارد.
- **ترتیب قفل در کل پروژه:** ردیف کاربر (در checkout و افزودن به سبد) ← ردیف درخواست ← ردیف کیف پول‌ها به ترتیب id. این ترتیب را عوض نکنید، وگرنه deadlock پیش می‌آید.

**شارژ کارت‌به‌کارت:**
1. کاربر `TopUpRequest` می‌سازد. این کار هنوز تراکنشی ثبت نمی‌کند.
2. `tracking_number` بین درخواست‌های غیر ردشده یکتاست (`topup_tracking_unique_unless_rejected`).
3. ادمین با `approve_topup` یا `reject_topup` تصمیم می‌گیرد. وضعیت‌های نهایی عوض نمی‌شوند.

**برداشت:**
1. `create_withdrawal` درخواست را می‌سازد و **همان لحظه** تراکنش `withdrawal` منفی ثبت می‌کند. فقط یک برداشت در انتظار برای هر کاربر مجاز است (`withdrawal_one_pending_per_user`).
2. `complete_withdrawal` فقط وضعیت را عوض می‌کند و تراکنشی نمی‌سازد.
3. `reject_withdrawal` تراکنش `withdrawal_reversal` ثبت می‌کند.
4. شمارهٔ کارت فقط روی `WithdrawalRequest` است و API آن را پوشیده برمی‌گرداند.

**درگاه:**
- `GatewayPayment` به‌اضافهٔ `credit_gateway_payment` (idempotent).
- امروز فقط `wallet/gateways/mock.py` هست و فقط با `DEBUG` کار می‌کند.
- برای درگاه واقعی: یک ماژول در `wallet/gateways/`، یک view برای callback که verify می‌کند و `credit_gateway_payment` را صدا می‌زند، و تغییر `active_gateway()`. docstring فایل `wallet/gateways/__init__.py` جزئیات را دارد.

**`transfer(legs)`** چند کیف پول را با هم جابه‌جا می‌کند و جمع پایه‌ها باید صفر باشد (حسابداری دوطرفه). همهٔ پایه‌ها یک `group` UUID مشترک می‌گیرند. `purchase_legs` پایه‌های یک سفارش را می‌سازد: یک بدهی برای خریدار، و برای هر کتاب `+seller_share` به بارگذارنده و `+commission` به مگابوک. پایه‌های صفر حذف می‌شوند.

### ۵.۷ `cart`

- `CartItem(user, book, price_seen)`. جدول `Cart` جدا نداریم و تعداد هم نداریم. قید یکتای `(user, book)` و سقف ۵۰ کتاب (`MAX_ITEMS`).
- `price_seen` را **سرور** از کتاب کپی می‌کند و فقط برای هشدار «قیمت عوض شد» به کار می‌رود. پول همیشه با قیمت فعلی کتاب گرفته می‌شود.
- وضعیت هر آیتم یکی از این‌هاست: `ok`، `price_changed` (قیمت با `price_seen` فرق دارد)، یا `unavailable` (کتاب تأییدشده نیست یا قیمت ندارد).
- `GET /cart/` کتاب‌هایی را که کاربر حالا مالکشان است **از سبد پاک می‌کند** و در `removed` گزارش می‌دهد.
- هر endpoint سبد، کل سبد را برمی‌گرداند (`cart_response`) و فرانت هیچ جمع یا وضعیتی را خودش حساب نمی‌کند.

### ۵.۸ `orders` و `library`

- `Order` (سربرگ؛ بدون status و بدون جمع ذخیره‌شده) و `OrderItem` (`price` و `seller_share` همان لحظه، به‌عنوان عکس لحظهٔ خرید). هر دو **تغییرناپذیرند** (`ImmutableOrderError`).
- `orders/services.checkout(user)` همه‌چیز را در یک تراکنش انجام می‌دهد:
  1. قفل ردیف کاربر.
  2. قفل ردیف‌های سبد (`of=("self",)`).
  3. همهٔ آیتم‌ها باید `ok` باشند، وگرنه `cart_changed`.
  4. بررسی دوبارهٔ مالکیت.
  5. ساخت `Order`، `OrderItem` و `LibraryItem`.
  6. `transfer`. اگر موجودی کم باشد، `insufficient_balance` همراه `shortfall`.
  7. خالی کردن سبد.
  
  اگر هر مرحله شکست بخورد، هیچ چیزی ذخیره نمی‌شود. کتاب رایگان سفارش و کتابخانه دارد، ولی هیچ تراکنشی در دفتر ندارد.
- `LibraryItem(user, book, order_item?)` با قید یکتای `(user, book)`، که آخرین محافظ در برابر دو بار خریدن یک کتاب است.
- **بازپرداخت در کد وجود ندارد** (DECISIONS ۶.۳).

### ۵.۹ `dashboard`

بدون مدل و فقط خواندنی. `dashboard/queries.py` پایهٔ مشترک شمارنده‌های داشبورد و فهرست‌های «درخواست‌ها و آپلودهای من» است، تا عددها و فهرست‌ها هیچ‌وقت با هم ناهماهنگ نشوند (DECISIONS ۱۱.۳).
- درآمد از تراکنش‌های `sale_income` دفتر حساب می‌شود.
- تعداد فروش از `OrderItem` شمرده می‌شود (کتاب رایگان هم حساب است).
- شمارش‌ها با subquery انجام می‌شوند، نه JOIN، تا ضرب ردیف‌ها پیش نیاید.

### ۵.۱۰ `support`

- `Conversation` دقیقاً یک والد دارد: یک `RequestEntry` (درخواست یک کاربر، نه `BookRequest` مشترک) **یا** یک `Book` (بارگذارنده‌اش). رابطه `OneToOne` است و قید `conversation_has_exactly_one_parent` آن را نگه می‌دارد.
- گفت‌وگو با اولین پیامش ساخته می‌شود و گفت‌وگوی خالی نداریم. GET روی والدی که گفت‌وگو ندارد، `state: open` و فهرست خالی برمی‌گرداند و چیزی نمی‌سازد.
- `Message` تغییرناپذیر و متن ساده است (حداکثر ۲۰۰۰ نویسه). `sender` یکی از `user`، `support` یا `system` است و **سرور** آن را تعیین می‌کند. کاربر نام ادمین را هرگز نمی‌بیند.
- **بستن:**
  - `closed_kind=fulfilled`: خودکار.
  - `closed_kind=support`: دستی، با دلیل داخلی.
  
  بستن فقط پیام تازهٔ کاربر را مسدود می‌کند. پشتیبانی همچنان می‌تواند بنویسد.
- **خوانده‌نشده** با دو زمان `user_last_read_at` و `support_last_read_at` حساب می‌شود و تعدادی ذخیره نمی‌شود.
- **گفت‌وگو برای خرید، شارژ و برداشت وجود ندارد.**
- سمت ادمین در `support/admin.py` است: پاسخ، بستن و بازگشایی، همه از راه `support/services.py`. باز کردن صفحهٔ گفت‌وگو در ادمین آن را «خوانده‌شده» حساب می‌کند.

---

## ۶. API

مسیرها نسبت به `http://<backend>:8000` هستند. «ورود» یعنی هدر `Authorization: Bearer <access>`. همهٔ پاسخ‌های خطا پیام فارسی دارند. داده‌های هر کاربر فقط مال خود اوست و شیء متعلق به دیگران همیشه 404 می‌دهد.

### accounts

| متد | مسیر | کار | دسترسی |
|---|---|---|---|
| POST | `/accounts/register/` | ثبت‌نام: `{first_name, last_name, email?, phone?, password}` ← `{user, access, refresh}` | همه |
| POST | `/accounts/login/` | ورود: `{identifier, password}` ← `{access, refresh, user}` | همه |
| POST | `/accounts/token/refresh/` | `{refresh}` ← `{access}` | همه (با refresh معتبر) |
| POST | `/accounts/logout/` | `{refresh}`: refresh را blacklist می‌کند | همه (با refresh) |
| GET | `/accounts/me/` | اطلاعات کاربر | ورود |
| PATCH | `/accounts/me/` | ویرایش نام، ایمیل و موبایل (برای ایمیل و موبایل `current_password` لازم است) | ورود |
| POST | `/accounts/me/password/` | `{current_password, new_password}` ← توکن تازه و خروج دستگاه‌های دیگر | ورود |

### catalog

| متد | مسیر | کار | دسترسی |
|---|---|---|---|
| GET | `/catalog/books/` | کتاب‌های تأییدشده، ۲۰ تا در هر صفحه. `?search=` (عنوان، شابک، نویسنده)، `?category=<id>`، `?page=` | همه |
| POST | `/catalog/books/` | بارگذاری کتاب (multipart) | ورود |
| GET | `/catalog/books/<id>/` | جزئیات کتاب تأییدشده (کتاب تأییدنشده: 404) | همه |
| GET | `/catalog/categories/` | فهرست موضوع‌ها | همه |
| GET | `/catalog/isbn-lookup/?isbn=` | مشخصات از Open Library به‌اضافهٔ وضعیت در مگابوک (200، 400، 404 یا 502) | ورود |
| GET | `/catalog/books/<id>/file-link/` | لینک امضاشدهٔ ۵ دقیقه‌ای فایل کامل ← `{url, expires_in, title}` | ورود و `can_download_file` |
| GET | `/catalog/books/<id>/file/?t=<token>` | خود PDF (view معمولی Django، قابل نمایش در iframe) | توکن معتبر، یا session ادمین |

### book-requests

| متد | مسیر | کار | دسترسی |
|---|---|---|---|
| GET | `/book-requests/` | درخواست‌های باز، ۱۰ تا در هر صفحه. `?ordering=newest\|most_requested`، `?search=`، `?page=` | همه |
| POST | `/book-requests/` | ثبت درخواست `{isbn, title, authors?, cover_url?, notes?}`. پاسخ 201 (`requested`) یا 409 (`available`، `in_review`، `rejected`، `already_requested`) | ورود |
| POST | `/book-requests/<id>/join/` | «من هم می‌خواهم». پاسخ 201 یا 200 (تکراری)، یا 409 | ورود |

### wallet

| متد | مسیر | کار | دسترسی |
|---|---|---|---|
| GET | `/wallet/` | `{balance, topup_card}` | ورود |
| GET | `/wallet/transactions/` | تاریخچه، ۲۰ تا در هر صفحه. `?type=all\|purchase\|sale_income\|topup\|withdrawal` | ورود |
| POST | `/wallet/mock-topup/` | `{amount}`: شارژ فوری | ورود، **فقط با `DEBUG`** (وگرنه 404) |
| GET | `/wallet/topup-requests/` | درخواست‌های شارژ من | ورود |
| POST | `/wallet/topup-requests/` | `{amount, tracking_number, deposited_at, receipt?}` (multipart) | ورود |
| GET | `/wallet/topup-requests/<id>/receipt-link/` | لینک امضاشدهٔ رسید | صاحب درخواست یا staff |
| GET | `/wallet/topup-requests/<id>/receipt/?t=` | تصویر رسید | توکن معتبر، یا session ادمین |
| GET | `/wallet/withdrawals/` | برداشت‌های من (کارت پوشیده) | ورود |
| POST | `/wallet/withdrawals/` | `{amount, card_number}`: کسر فوری | ورود |

### cart و orders

| متد | مسیر | کار | دسترسی |
|---|---|---|---|
| GET | `/cart/` | `{items, removed, count, total, balance}` | ورود |
| DELETE | `/cart/` | خالی کردن سبد | ورود |
| POST | `/cart/items/` | `{book_id}`: پاسخ 201 (افزوده شد) یا 200 (از قبل بود)، یا 409 `{code}`: `not_available`، `own_upload`، `already_owned`، `cart_full` | ورود |
| DELETE | `/cart/items/<book_id>/` | حذف یک کتاب | ورود |
| POST | `/cart/acknowledge-prices/` | `{book_id?}`: تأیید قیمت تازه | ورود |
| POST | `/orders/checkout/` | خرید کل سبد. پاسخ 201 (سفارش)، 400 (`empty_cart`)، یا 409 (`cart_changed` و `already_owned` همراه `cart`؛ `insufficient_balance` همراه `shortfall`) | ورود |
| GET | `/orders/` | سفارش‌های من، ۲۰ تا در هر صفحه | ورود |

### library، dashboard و support

| متد | مسیر | کار | دسترسی |
|---|---|---|---|
| GET | `/library/` | کتاب‌های خریده‌شده، ۶ تا در هر صفحه | ورود |
| GET | `/library/uploads/` | بارگذاری‌های تأییدشدهٔ من، ۶ تا در هر صفحه | ورود |
| GET | `/library/summary/` | `{purchased, uploaded, bookmarked: null}` | ورود |
| GET | `/dashboard/` | `{user, wallet, cart, requests, uploads}` | ورود |
| GET | `/dashboard/requests/` | درخواست‌های من، ۱۰ تا در هر صفحه. `?status=open\|fulfilled\|rejected`، `?search=` | ورود |
| GET | `/dashboard/uploads/` | بارگذاری‌های من با فروش و درآمد. `?status=pending\|approved\|rejected`، `?search=` | ورود |
| GET | `/support/requests/<entry_id>/` | گفت‌وگوی یک درخواست من (`?after=<message_id>` برای polling) | ورود، صاحب |
| POST | `/support/requests/<entry_id>/messages/` | `{text}`. پاسخ 201، یا 409 (بسته)، یا 429 (بیش از ۱۰ پیام در دقیقه) | ورود، صاحب |
| POST | `/support/requests/<entry_id>/read/` | علامت «خواندم». پاسخ 204 | ورود، صاحب |
| GET / POST / POST | `/support/uploads/<book_id>/`، `.../messages/`، `.../read/` | همان سه مورد برای کتاب بارگذاری‌شدهٔ من | ورود، بارگذارنده |
| GET | `/support/unread/` | `{requests: {id: n}, uploads: {id: n}}` | ورود |

### غیر API

| مسیر | کار |
|---|---|
| `/admin/` | پنل ادمین Django (staff؛ ورود با ایمیل یا موبایل و رمز) |
| `/admin/wallet/wallet/<id>/adjust/` | فرم اصلاح دستی |
| `/media/...` | جلد و فایل نمونه؛ **فقط با `DEBUG`** توسط Django سرو می‌شود |

---

## ۷. فرانت

ساختار: `src/main.jsx` (یک `BrowserRouter` و `CartProvider`)، `src/App.jsx` (routeها)، `src/api/*.js` (یک فایل برای هر اپ بک‌اند، همه روی `apiClient` از `client.js`)، `src/components/*.jsx` (صفحه‌ها)، `src/context/` (سبد)، `src/hooks/`، و `src/utils/format.js`.

- `ProtectedRoute` فقط وجود `refresh_token` را بررسی می‌کند و کاربر بدون توکن را به `/login` می‌فرستد. بررسی واقعی دسترسی همیشه در بک‌اند است.
- سبد یک Context سراسری است (`CartProvider`) که با رویداد `megabook:auth-changed` بعد از ورود و خروج دوباره بار می‌شود. checkout هم از همین‌جا صدا زده می‌شود.

| مسیر | کامپوننت | ورود؟ | داده از |
|---|---|---|---|
| `/` | `HomePage` | — | `GET /catalog/categories/`، `GET /catalog/books/?category=` |
| `/login` | `Login` | — | `POST /accounts/login/` |
| `/signup` | `Signup` | — | `POST /accounts/register/` |
| `/books/:id` | `BookDetailPage` | — | `GET /catalog/books/<id>/`، سبد از Context |
| `/books/new` | `AddBookWizard` (فرم ۶ مرحله‌ای) | ✅ | `GET /accounts/me/` (برای `is_staff`)، `GET /catalog/categories/`، `GET /catalog/isbn-lookup/`، `POST /catalog/books/` |
| `/requests` | `PublicRequestsPage` | — | `GET /book-requests/`، `POST /book-requests/<id>/join/` |
| `/requests/new` | `RequestByIsbnPage` | ✅ | `GET /catalog/isbn-lookup/`، `POST /book-requests/` |
| `/requests/:id` | `ConversationPage kind="request"` | ✅ | `/support/requests/<id>/...` (polling هر ۱۵ ثانیه) |
| `/uploads/:id` | `ConversationPage kind="upload"` | ✅ | `/support/uploads/<id>/...` |
| `/cart` | `CartPage` | ✅ | `CartProvider`: `/cart/...` و `POST /orders/checkout/` |
| `/wallet` | `WalletPage` | ✅ | `/wallet/`، `/wallet/transactions/`، `/wallet/mock-topup/`، `/wallet/topup-requests/...`، `/wallet/withdrawals/` |
| `/library` | `LibraryPage` (تب‌ها: خریداری‌شده، بارگذاری‌شده، نشان‌شده) | ✅ | `GET /library/`، `/library/uploads/`، `/library/summary/` |
| `/library/:id/read` | `BookReaderPage` (PDF در iframe) | ✅ | `GET /catalog/books/<id>/file-link/` |
| `/dashboard` | `DashboardPage` | ✅ | `GET /dashboard/`، `POST /accounts/logout/` |
| `/dashboard/my-items` | `MyRequestsUploadsPage` (`?tab=requests\|uploads&status=`) | ✅ | `GET /dashboard/requests/`، `/dashboard/uploads/`، `/support/unread/` |
| `/account` | `AccountPage` | ✅ | `GET`/`PATCH /accounts/me/`، `POST /accounts/logout/` |
| `/settings/password` | `ChangePasswordPage` | ✅ | `POST /accounts/me/password/` |
| `*` | به `/` هدایت می‌شود | | |

نکته‌ها:
- `src/api/library.js` و `src/api/dashboard.js` هر دو تابعی به نام `getMyUploads` دارند، ولی endpointهایشان فرق دارد (`/library/uploads/` و `/dashboard/uploads/`). مراقب import باشید.
- `GET /orders/` در هیچ صفحه‌ای استفاده نمی‌شود (صفحهٔ تاریخچهٔ سفارش نداریم).
- `src/components/BookCard(me).jsx` جایی import نمی‌شود و کد مرده است.

---

## ۸. فایل‌ها و media

| فایل | فیلد | مسیر روی دیسک | عمومی؟ |
|---|---|---|---|
| جلد کتاب | `Book.cover` | `backend/MegaBook_Backend/media/books/covers/` | ✅ با `/media/...` |
| نمونهٔ رایگان | `Book.sample_file` | `media/books/samples/` | ✅ (عمداً، چون رایگان است) |
| **فایل کامل کتاب** | `Book.book_file` | `private_media/books/files/<uuid>.pdf` | ❌ |
| **رسید شارژ** | `TopUpRequest.receipt` | `private_media/wallet/receipts/<uuid>.<ext>` | ❌ |

هر دو پوشه داخل پوشهٔ بک‌اند هستند و با volume روی میزبان می‌مانند. در `.gitignore` و `.dockerignore` هستند، پس **نه در git می‌روند و نه در ایمیج**. **پشتیبان‌گیری از این دو پوشه به‌اندازهٔ دیتابیس مهم است** (بخش ۱۱).

محافظت فایل‌های خصوصی سه لایه دارد (`MegaBook_Backend/private_files.py`، DECISIONS ۳.۱۵):

1. **Storage جدا بیرون از `MEDIA_ROOT`، بدون هیچ URL.** `PrivateStorage.url()` خطا می‌دهد، پس اشتباهاً هم در API ظاهر نمی‌شوند.
2. **نام تصادفی** (`RandomName`، یک UUID)، تا مسیر حدس‌زدنی نباشد.
3. **دانلود فقط از view با بررسی اجازه:**
   1. فرانت با JWT از `.../file-link/` یک لینک امضاشده می‌گیرد. `TimestampSigner` با salt جدا برای هر نوع فایل استفاده می‌شود، پس توکن رسید فایل کتاب را باز نمی‌کند. لینک مخصوص یک شیء و یک کاربر است و بعد از ۳۰۰ ثانیه منقضی می‌شود.
   2. view دانلود توکن را بررسی می‌کند و **اجازه را دوباره** می‌سنجد.
   3. پاسخ `Cache-Control: private, no-store` و `Content-Disposition: inline` دارد.
   
   ادمینی که در پنل وارد شده، با session و بدون توکن رد می‌شود.

**در production پشت nginx:** اگر `PRIVATE_MEDIA_ACCEL_PREFIX` (مثلاً `/protected/`) تنظیم شود، Django فقط اجازه را بررسی می‌کند و هدر `X-Accel-Redirect` برمی‌گرداند. خود فایل را nginx می‌فرستد. پیکربندی nginx لازم (هنوز ساخته نشده):

```nginx
location /protected/ {
    internal;                       # از بیرون مستقیم قابل دسترسی نیست
    alias /path/to/private_media/;  # [جای خالی: مسیر واقعی روی سرور]
}
location /media/ {
    alias /path/to/media/;          # [جای خالی]
}
```

`private_media` **هرگز** نباید زیر `location`ی بدون `internal` سرو شود.

---

## ۹. عیب‌یابی

### ۹.۱ پکیج روی سیستم میزبان نصب شده، نه داخل کانتینر

- **نشانه:** بعد از `pip install x` یا `npm install x`، خطای `ModuleNotFoundError` یا `Failed to resolve import` همچنان هست.
- **علت:** کد داخل کانتینر اجرا می‌شود و پکیج‌های ویندوز آنجا دیده نمی‌شوند. در مخزن یک `backend/MegaBook_Backend/venv` روی میزبان هست که **با کانتینر فرق دارد** (مثلاً psycopg 3 دارد به‌جای psycopg2، و Pillow و requests را ندارد). اجرای `python manage.py ...` با آن venv نتیجهٔ گمراه‌کننده می‌دهد.
- **راه حل:** پکیج را به `requirements.txt` یا `package.json` اضافه کنید و `docker compose up --build -d` بزنید. برای امتحان سریع: `docker compose exec backend pip install x` (با ساختن دوبارهٔ کانتینر از بین می‌رود). همهٔ دستورهای `manage.py` را با `docker compose exec backend ...` اجرا کنید.
- برای فرانت: `node_modules` در یک volume ناشناس جدا است. بعد از تغییر `package.json` حتماً build کنید. اگر باز هم پکیج کهنه ماند: `docker compose down` و بعد `docker compose up --build -d --renew-anon-volumes`.

### ۹.۲ مسیر volume با `WORKDIR` نمی‌خواند

- **نشانه:** تغییر کد اثری ندارد، `manage.py` پیدا نمی‌شود، یا کانتینر کد کهنهٔ داخل ایمیج را اجرا می‌کند.
- **علت:** volume در `docker-compose.yml` (`./backend/MegaBook_Backend:/app`) باید دقیقاً روی `WORKDIR /app` در Dockerfile سوار شود. همین برای فرانت هم صدق می‌کند.
- **راه حل:** اگر یکی را عوض می‌کنید، دیگری را هم عوض کنید. بررسی: `docker compose exec backend ls /app` باید `manage.py` را نشان دهد.

### ۹.۳ یک Vite محلی پورت 5173 را گرفته

- **نشانه:** صفحه باز می‌شود ولی تغییرها دیده نمی‌شوند یا رفتار عجیب است، یا کانتینر frontend با خطای پورت بالا نمی‌آید.
- **علت:** `npm run dev` روی خود ویندوز هم اجرا شده و درخواست‌ها به آن می‌روند، نه به کانتینر.
- **راه حل:** Vite محلی را ببندید. پیدا کردنش در PowerShell: `Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess`. بعد `docker compose restart frontend`.

### ۹.۴ نام پوشهٔ تنظیمات

- **نشانه:** `ModuleNotFoundError: No module named 'MegaBook_Backend'` یا `ImproperlyConfigured: WSGI application ...`.
- **علت:** نام پوشهٔ `MegaBook_Backend/` (داخل `backend/MegaBook_Backend/`) در چهار جا تکرار شده است.
- **راه حل:** اگر پوشه را تغییر نام دادید، همه را با هم عوض کنید:
  - `ROOT_URLCONF = 'MegaBook_Backend.urls'` و `WSGI_APPLICATION = 'MegaBook_Backend.wsgi.application'` و `TEST_RUNNER` در `settings.py`
  - `DJANGO_SETTINGS_MODULE` در `manage.py`، `wsgi.py` و `asgi.py`
  - importهای `from MegaBook_Backend.private_files ...` در `catalog/models.py`، `catalog/views.py`، `catalog/admin.py`، `wallet/models.py`، `wallet/views.py` و migrationهایی که به `private_storage` اشاره می‌کنند

### ۹.۵ به‌روزرسانی گروهی از `save()` رد می‌شود

- **نشانه:** بعد از `Book.objects.filter(...).update(status="approved")` (در shell، یک migration، یا یک admin action که با `update()` نوشته شده)، درخواست کتاب «تأمین شده» نمی‌شود و بارگذارنده پیامی نمی‌گیرد. یا `IntegrityError` با نام یک قید مثل `approved_book_price_covers_seller_share` می‌آید.
- **علت:** `QuerySet.update()` و `bulk_create` نه `save()` را صدا می‌زنند و نه سیگنال‌ها را. قیدهای دیتابیس جلوی دادهٔ غلط را می‌گیرند، ولی اثرهای جانبی (`sync_with_book`، پیام‌های سیستمی، ساختن کیف پول برای کاربر تازه) اجرا نمی‌شوند.
- **راه حل:** روی ردیف‌ها حلقه بزنید و `obj.save()` کنید. اگر کتاب‌ها قبلاً با `update()` تأیید شده‌اند، `python manage.py fulfil_requests_on_sale` درخواست‌ها را درست می‌کند. اگر کاربرها با `bulk_create` ساخته شده‌اند، برای هر کدام `wallet.services.ensure_user_wallet(user)` را صدا بزنید.
- برای `LedgerEntry`، `Order`، `OrderItem` و `Message`، `update()` و `delete()` عمداً خطا می‌دهند (بخش ۹.۹).

### ۹.۶ تغییر `.env` اثر نکرد

- **نشانه:** مقدار تازهٔ `DJANGO_DEBUG` یا شمارهٔ کارت دیده نمی‌شود.
- **راه حل:** `docker compose up -d`، که کانتینر را با env تازه از نو می‌سازد. `restart` کافی نیست.
- **توجه:** اگر `POSTGRES_PASSWORD` را بعد از بار اول عوض کنید، Postgres رمزش را عوض نمی‌کند، چون volume از قبل ساخته شده. یا رمز را داخل `psql` عوض کنید، یا (فقط در توسعه) volume را پاک کنید.

### ۹.۷ خطاهای رایج دیگر

| نشانه | علت | راه حل |
|---|---|---|
| `relation "..." does not exist` | migrationها اجرا نشده‌اند (خودکار اجرا نمی‌شوند) | `docker compose exec backend python manage.py migrate` |
| `seed_books`: `No superuser found` | عمداً superuser نمی‌سازد | اول `createsuperuser` |
| `could not translate host name "db"` | بک‌اند بیرون از Compose اجرا شده، یا `POSTGRES_HOST` غلط است | از Compose اجرا کنید؛ برای اجرای محلی `POSTGRES_HOST=localhost` |
| خطای `decouple.UndefinedValueError: DJANGO_SECRET_KEY not found` | `.env` نیست یا متغیر جا افتاده | بخش ۳.۱ |
| شارژ آنلاین: «پرداخت آنلاین هنوز فعال نیست» (404) | `DEBUG` خاموش است و درگاه واقعی نداریم | انتظار می‌رود؛ از کارت‌به‌کارت استفاده کنید |
| `400 Bad Request` روی همهٔ صفحه‌ها با `DEBUG` خاموش | میزبان در `DJANGO_ALLOWED_HOSTS` نیست | دامنه را اضافه کنید |
| خطای CORS در console مرورگر | origin فرانت در `CORS_ALLOWED_ORIGINS` نیست (ثابت در `settings.py`) | origin را اضافه کنید |
| جلدها و نمونه‌ها 404 با `DEBUG` خاموش | Django بدون `DEBUG`، `/media/` را سرو نمی‌کند | وب‌سرور باید `/media/` را سرو کند (بخش ۸) |
| `ProtectedError` هنگام حذف کاربر یا کتاب | کاربر تراکنش، سفارش یا کتاب دارد؛ کتاب فروخته شده یا در کتابخانهٔ کسی است | عمدی است (DECISIONS ۳.۹). کاربر را غیرفعال کنید، یا وضعیت کتاب را عوض کنید. |
| `ImmutableLedgerError` / `ImmutableOrderError` / `ImmutableMessageError` | تلاش برای ویرایش یا حذف تراکنش، سفارش یا پیام | عمدی است. با «اصلاح دستی» جبران کنید. |
| «وضعیت نهایی درخواست قابل تغییر نیست» | تلاش برای عوض کردن شارژ یا برداشت نهایی‌شده | اصلاح دستی |
| `429` روی ارسال پیام | بیش از ۱۰ پیام در دقیقه | عمدی است. شمارش برای هر پروسه جداست؛ با چند worker باید cache مشترک (Redis) گذاشت. |
| صفحهٔ خواندن کتاب خالی است یا «پیدا نشد» می‌دهد | لینک ۵ دقیقه‌ای منقضی شده، یا فایل روی دیسک نیست | صفحه را دوباره باز کنید. وجود فایل را در `private_media/books/files/` بررسی کنید. `file_size` در API برای فایل گم‌شده `null` است. |
| `isbn-lookup` همیشه 502 می‌دهد | بک‌اند به openlibrary.org دسترسی ندارد | `docker compose exec backend python -c "import requests; print(requests.get('https://openlibrary.org', timeout=5).status_code)"` |
| کاربر بعد از ۳۰ دقیقه بیرون انداخته می‌شود | refresh منقضی یا blacklist شده (مثلاً بعد از تغییر رمز در دستگاه دیگر) | رفتار درست است. اگر بعد از عوض کردن `DJANGO_SECRET_KEY` همه بیرون افتادند، آن هم طبیعی است. |
| خطای deadlock یا انتظار طولانی روی پول | کدی کیف پول‌ها را خارج از ترتیب id قفل کرده | فقط از توابع `wallet/services.py` استفاده کنید (بخش ۵.۶) |

---

## ۱۰. ساخته‌نشده و محدودیت‌های شناخته‌شده

**ساخته نشده:**
- پنل مدیریت React. همهٔ کارهای ادمین در Django admin انجام می‌شود.
- اعلان‌ها (زنگ اعلان از داشبورد برداشته شده) و ارسال ایمیل یا پیامک.
- نظر و امتیاز (`Review`).
- درگاه پرداخت واقعی. فقط ماک در `DEBUG` هست.
- نشان کردن کتاب (bookmark). `bookmarked: null` و تب خالی.
- فهرست «پرفروش‌ها». `HomePage` فعلاً ۴ کتاب اول «تازه‌ها» را نشان می‌دهد.
- جعبهٔ جستجو در صفحهٔ اصلی (API از `?search=` پشتیبانی می‌کند).
- فراموشی رمز، و تأیید ایمیل یا موبایل (OTP).
- گفت‌وگوی پشتیبانی برای خرید، شارژ یا برداشت. دکمهٔ «درخواست پشتیبانی» از داشبورد برداشته شده.
- فرستادن دوبارهٔ فایل سالم به خریدار (DECISIONS ۶.۳). فقط می‌شود `book_file` را در ادمین عوض کرد، که روی همهٔ خریداران اثر می‌گذارد.
- صفحهٔ تاریخچهٔ سفارش (`GET /orders/` هست، ولی صفحه نیست).
- لینک موضوع در صفحهٔ کتاب، و لینک‌های فوتر (`href="#"`).
- فیلد «دلیل رد» برای کتاب. دلیل در گفت‌وگو نوشته می‌شود.

**محدودیت‌ها:**
- **هیچ پیکربندی production وجود ندارد:** `runserver` و Vite dev server، بدون gunicorn یا uvicorn، بدون nginx، بدون `STATIC_ROOT` و `collectstatic` (پنل ادمین بدون `DEBUG` بدون CSS می‌ماند)، و بدون build فرانت.
- آدرس بک‌اند در `frontend/MegaBook_frontend/src/api/client.js` ثابت است (`http://localhost:8000`). برای production باید به یک متغیر Vite (`import.meta.env`) تبدیل شود.
- `CORS_ALLOWED_ORIGINS` در کد ثابت است.
- بیشتر پکیج‌های بک‌اند پین نشده‌اند (بخش ۲.۱).
- throttle روی LocMemCache است و با چند پروسه درست شمارش نمی‌کند.
- توکن‌ها در `localStorage` هستند و در برابر XSS آسیب‌پذیرند. متن پیام‌ها هرگز به‌صورت HTML نمایش داده نمی‌شود.
- بک‌اند هیچ پیکربندی logging ندارد (فقط پیش‌فرض Django روی console).
- `LANGUAGE_CODE='en-us'`، پس پیام‌های پیش‌فرض پنل ادمین انگلیسی‌اند. پیام‌های API فارسی هستند و دستی نوشته شده‌اند.
- `<title>` صفحهٔ فرانت هنوز `megabook-frontend` است (`index.html`).
- `src/components/BookCard(me).jsx` کد مرده است.

---

## ۱۱. Deployment (برای پر کردن)

> هیچ‌کدام از موارد زیر از روی کد قابل تشخیص نیست. لطفاً پر کنید.

| موضوع | مقدار |
|---|---|
| ارائه‌دهنده و مشخصات سرور | **[جای خالی]** |
| دامنهٔ سایت و دامنهٔ API | **[جای خالی]** |
| گواهی HTTPS (صادرکننده، تمدید) | **[جای خالی]** |
| محل نگهداری اسرار (`DJANGO_SECRET_KEY`، رمز دیتابیس) و دسترسی‌ها | **[جای خالی]** |
| شمارهٔ کارت و نام صاحب حساب مگابوک (`MEGABOOK_CARD_*`) | **[جای خالی]** |
| WSGI server (gunicorn؟) و تعداد worker | **[جای خالی]** |
| پیکربندی nginx (`/media/`، `/protected/`، `/static/`، proxy به بک‌اند، سرو `dist/` فرانت) | **[جای خالی]** |
| روند build فرانت (`npm run build`) و آدرس API در آن | **[جای خالی]** |
| دیتابیس: داخل Compose یا سرویس مدیریت‌شده؟ | **[جای خالی]** |
| پشتیبان‌گیری از دیتابیس (`pg_dump`؛ زمان‌بندی، محل نگهداری، آزمایش بازگردانی) | **[جای خالی]** |
| پشتیبان‌گیری از `media/` و `private_media/` | **[جای خالی]** |
| روند انتشار نسخهٔ تازه (pull، build، `migrate`، restart) | **[جای خالی]** |
| مانیتورینگ و log | **[جای خالی]** |
| حساب‌های superuser و افرادی که دسترسی دارند | **[جای خالی]** |
| کانال پشتیبانی بیرون از سایت | **[جای خالی]** |

چک‌لیست حداقلی پیش از انتشار (از روی کد):
- [ ] `DJANGO_DEBUG=False`
- [ ] `DJANGO_SECRET_KEY` تازه، که با کلید داخل تاریخچهٔ git فرق داشته باشد
- [ ] `DJANGO_ALLOWED_HOSTS` با دامنهٔ واقعی
- [ ] `CORS_ALLOWED_ORIGINS` و آدرس API فرانت به دامنهٔ واقعی
- [ ] `STATIC_ROOT` و `collectstatic`
- [ ] سرو `/media/` و `internal` بودن `/protected/` در nginx، همراه `PRIVATE_MEDIA_ACCEL_PREFIX`
- [ ] پورت 5432 دیتابیس به اینترنت باز نباشد (Compose فعلی آن را روی میزبان باز می‌کند)
- [ ] `MEGABOOK_CARD_NUMBER` و `MEGABOOK_CARD_HOLDER`
- [ ] پین کردن نسخهٔ پکیج‌ها
- [ ] `docker compose exec backend python manage.py check --deploy`
