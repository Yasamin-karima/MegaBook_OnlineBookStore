# یادداشت‌های یادگیری مگابوک

این سند برای خودت است: برای روزی که برمی‌گردی سراغ کد و می‌خواهی بفهمی چه ساخته‌ای و **چرا** هر تکهٔ غیرواضح این شکلی نوشته شده.

فرض این سند این است که برنامه‌نویسی بلدی، ولی Django، DRF، React و Docker برایت تازه‌اند. چیزهای بدیهی (فیلدهای ساده، boilerplate) را توضیح نمی‌دهم و وقت را روی جاهای سخت می‌گذارم.

برای سه سؤال دیگر سراغ این سندها برو:
- «سیستم الان چه می‌کند؟» ← [راهنمای فنی](MAINTENANCE_TECHNICAL.md)
- «چرا این تصمیم گرفته شد و چه گزینه‌هایی رد شد؟» ← [`DECISIONS.md`](../DECISIONS.md)
- «این کد چطور کار می‌کند و اگر نبود چه می‌شد؟» ← همین سند

مسیرها نسبت به ریشهٔ مخزن‌اند. پوشهٔ بک‌اند را برای کوتاهی `backend/` و پوشهٔ فرانت را `frontend/` می‌نویسم. یعنی `backend/wallet/services.py` همان `backend/MegaBook_Backend/wallet/services.py` است و `frontend/src/...` همان `frontend/MegaBook_frontend/src/...`.

---

## فهرست

1. [نقشهٔ کلی در یک نگاه](#۱-نقشهٔ-کلی-در-یک-نگاه)
2. [Docker و پیکربندی](#۲-docker-و-پیکربندی)
3. [الگوهایی که همه‌جا تکرار می‌شوند](#۳-الگوهایی-که-همهجا-تکرار-میشوند)
4. [`accounts`: کاربر و ورود](#۴-accounts-کاربر-و-ورود)
5. [`catalog`: کتاب، بارگذاری، فایل خصوصی](#۵-catalog-کتاب-بارگذاری-فایل-خصوصی)
6. [`book_requests`: درخواست کتاب](#۶-book_requests-درخواست-کتاب)
7. [`wallet`: دفتر پول](#۷-wallet-دفتر-پول)
8. [`cart`: سبد خرید](#۸-cart-سبد-خرید)
9. [`orders` و `library`: خرید و کتابخانه](#۹-orders-و-library-خرید-و-کتابخانه)
10. [`dashboard`: شمارش و پیگیری](#۱۰-dashboard-شمارش-و-پیگیری)
11. [`support`: گفت‌وگو با پشتیبانی](#۱۱-support-گفتوگو-با-پشتیبانی)
12. [فرانت](#۱۲-فرانت)
13. [چهار مسیر کامل، از کلیک تا دیتابیس](#۱۳-چهار-مسیر-کامل-از-کلیک-تا-دیتابیس)
14. [واژه‌نامه](#۱۴-واژهنامه)
15. [چیزهایی که ارزش بررسی دارند](#۱۵-چیزهایی-که-ارزش-بررسی-دارند)

---

## ۱. نقشهٔ کلی در یک نگاه

```
React (Vite, :5173)  ──axios + JWT──►  Django + DRF (:8000)  ──►  PostgreSQL (:5432)
                                            │
                                            └──► Open Library (فقط از بک‌اند)
```

بک‌اند از چند «اپ» Django ساخته شده و هر کدام یک حوزه است. ترتیب وابستگی‌شان از پایین به بالا:

```
accounts  ←  catalog  ←  book_requests, wallet  ←  cart, orders, library  ←  support  ←  dashboard
```

**قانون نانوشته:** اپ پایین‌تر هیچ‌وقت در بالای فایل اپ بالاتر را import نمی‌کند. هر جا این کار لازم بوده (مثلاً `Book.save()` باید به `support` خبر بدهد)، import **داخل تابع** انجام شده. دلیلش در بخش ۳.۸ آمده.

---

## ۲. Docker و پیکربندی

### ۲.۱ `docker-compose.yml`

سه سرویس تعریف می‌کند. نکته‌های غیرواضحش این‌هاست:

```yaml
backend:
  volumes:
    - ./backend/MegaBook_Backend:/app       # live-sync your local code into the container
  command: python manage.py runserver 0.0.0.0:8000
  env_file:
    - ./backend/MegaBook_Backend/.env
```

- **volume:** پوشهٔ روی ویندوز را روی `/app` کانتینر «سوار» می‌کند. کدی که ویرایش می‌کنی همان لحظه داخل کانتینر هست و `runserver` با دیدن تغییر خودش را reload می‌کند. بدون این خط، باید بعد از هر تغییر ایمیج را از نو می‌ساختی.
- **`0.0.0.0` به‌جای `127.0.0.1`:** داخل کانتینر، `127.0.0.1` یعنی «فقط خود کانتینر». با `0.0.0.0` سرور به درخواست‌هایی هم که از بیرون (از طریق پورت 8000 میزبان) می‌آیند جواب می‌دهد.
- **`env_file`:** متغیرهای `.env` را در محیط کانتینر می‌گذارد. همین فایل به سرویس `db` هم داده شده، چون ایمیج رسمی Postgres از `POSTGRES_DB`، `POSTGRES_USER` و `POSTGRES_PASSWORD` برای ساختن دیتابیس استفاده می‌کند، **ولی فقط بار اول**، وقتی volume داده خالی است.

```yaml
frontend:
  volumes:
    - ./frontend/MegaBook_frontend:/app
    - /app/node_modules
  environment:
    - CHOKIDAR_USEPOLLING=true
```

- **خط دوم volume** ظریف است. خط اول کل پوشه را، از جمله `node_modules`، روی `/app` می‌گذارد. ولی `node_modules` روی ویندوز یا نیست یا برای سیستم‌عامل دیگری ساخته شده. `/app/node_modules` بدون مسیر میزبان یک **volume ناشناس** است که روی همان زیرپوشه قرار می‌گیرد و `node_modules`ی را که `npm install` داخل ایمیج ساخته حفظ می‌کند. بدون آن، فرانت با خطای «پکیج پیدا نشد» بالا نمی‌آمد.
- **`CHOKIDAR_USEPOLLING`:** تغییر فایل از ویندوز به داخل کانتینر لینوکسی همیشه «رویداد» نمی‌فرستد. با این متغیر، Vite هر چند وقت یک بار خودش فایل‌ها را نگاه می‌کند (polling). بدون آن، HMR روی ویندوز گاهی کار نمی‌کرد.
- **`volumes: postgres_data:`** در انتهای فایل یک volume **نام‌دار** است. داده‌های دیتابیس با `docker compose down` پاک نمی‌شوند، فقط با `down -v`.

### ۲.۲ Dockerfileها

```dockerfile
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

چرا دو بار `COPY`؟ Docker هر خط را یک «لایه» می‌کند و اگر ورودی آن خط عوض نشده باشد، از نتیجهٔ قبلی (cache) استفاده می‌کند. اگر اول همه‌چیز را کپی می‌کردیم، با هر تغییر کوچک در کد `pip install` دوباره اجرا می‌شد. حالا فقط وقتی `requirements.txt` عوض شود پکیج‌ها دوباره نصب می‌شوند. Dockerfile فرانت همین کار را با `package.json` و `package-lock.json` می‌کند.

`.dockerignore` (در هر دو پوشه) مثل `.gitignore` برای Docker است. نکتهٔ مهم بک‌اند این است که `media/` و `private_media/` و `.env` وارد ایمیج نمی‌شوند. فایل‌های کاربران داده‌اند، نه کد، و `.env` اسرار دارد.

### ۲.۳ تنظیم‌هایی در `backend/MegaBook_Backend/settings.py` که با پیش‌فرض Django فرق دارند

| تنظیم | چه می‌کند | اگر نبود |
|---|---|---|
| `SECRET_KEY = config('DJANGO_SECRET_KEY')` | کلید از `.env` خوانده می‌شود (`python-decouple`) | کلید در git عمومی می‌شد. هر کس آن را داشته باشد می‌تواند JWT و لینک دانلود جعل کند. |
| `DEBUG = config(..., default=False, cast=bool)` | پیش‌فرض **خاموش** است | اگر روی سرور فراموش می‌شد، صفحه‌های خطای مفصل (با تکه‌های کد و تنظیمات) و درگاه ماک روشن می‌ماندند. |
| `AUTH_USER_MODEL = 'accounts.Account'` | مدل کاربر خودمان | مدل پیش‌فرض `username` اجباری دارد و ورود با موبایل را پشتیبانی نمی‌کند. **این تنظیم باید پیش از اولین migration گذاشته شود.** عوض کردنش بعداً بسیار دردناک است. |
| `AUTHENTICATION_BACKENDS` | فقط `IdentifierBackend` | `ModelBackend` پیش‌فرض فقط با `USERNAME_FIELD` (ایمیل) کار می‌کرد. |
| `UserAttributeSimilarityValidator` با `phone` | رمز نباید شبیه موبایل باشد | فهرست پیش‌فرض `username` دارد که در مدل ما نیست. |
| `REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'] = AllowAny` | هر view باید خودش بگوید چه کسی اجازه دارد | هیچ‌چیز خراب نمی‌شد، ولی یعنی **فراموش کردن `permission_classes` یک view را عمومی می‌کند.** همهٔ viewهای پروژه آن را صریح نوشته‌اند. |
| `DEFAULT_THROTTLE_RATES` | فقط برای scope `support_messages` | بدون آن، `ScopedRateThrottle` در view پیام‌ها خطا می‌داد. |
| `SIMPLE_JWT` | access ۳۰ دقیقه، refresh ۷ روز | پیش‌فرض simplejwt پنج دقیقه است و کاربر مدام refresh می‌کرد. |
| `rest_framework_simplejwt.token_blacklist` در `INSTALLED_APPS` | جدول `OutstandingToken` و `BlacklistedToken` | logout و «خروج از همهٔ دستگاه‌ها» ممکن نبود، چون JWT بدون جدول قابل باطل کردن نیست. |
| `corsheaders` و `CORS_ALLOWED_ORIGINS` | به مرورگر اجازه می‌دهد از `:5173` به `:8000` درخواست بدهد | مرورگر پاسخ‌ها را مسدود می‌کرد. **`CorsMiddleware` باید اول `MIDDLEWARE` باشد** تا روی پاسخ‌های خطا هم هدر بگذارد. |
| `PRIVATE_MEDIA_ROOT`، `PRIVATE_FILE_LINK_SECONDS`، `PRIVATE_MEDIA_ACCEL_PREFIX` | فایل‌های خصوصی (بخش ۵.۶) | — |
| `TEST_RUNNER` | تست‌ها `private_media` را در پوشهٔ موقت می‌گذارند | تست‌ها پوشهٔ واقعی `private_media/` را پر از PDF آزمایشی می‌کردند. |
| `MEGABOOK_CARD_*` | شمارهٔ کارت مگابوک از `.env` | — |

`backend/MegaBook_Backend/test_runner.py` کوتاه است. `DiscoverRunner` (اجراکنندهٔ پیش‌فرض تست) را گسترش می‌دهد و قبل از تست‌ها `settings.PRIVATE_MEDIA_ROOT` را به یک `tempfile.mkdtemp()` عوض می‌کند و بعد پاکش می‌کند. چرا این کار جواب می‌دهد؟ چون `PrivateStorage` مسیر را **هر بار** از settings می‌خواند (بخش ۵.۶).

---

## ۳. الگوهایی که همه‌جا تکرار می‌شوند

این بخش مهم‌ترین بخش سند است. اگر این هشت الگو را بفهمی، بیشتر کد پروژه خودش معنی پیدا می‌کند.

### ۳.۱ قاعده‌ها هم در `clean()` و هم در `save()`

مثال از `backend/book_requests/models.py`:

```python
def apply_status_rules(self):
    self.rejection_reason = (self.rejection_reason or "").strip()
    if self.status == self.Status.REJECTED:
        if not self.rejection_reason:
            raise ValidationError({"rejection_reason": REJECTION_REASON_REQUIRED})
    else:
        self.rejection_reason = ""

def clean(self):
    super().clean()
    self.apply_status_rules()

def save(self, *args, **kwargs):
    self.apply_status_rules()
    ...
```

**مشکل:** خیلی‌ها فکر می‌کنند `clean()` همیشه قبل از ذخیره اجرا می‌شود. نمی‌شود. Django `clean()` را فقط از `full_clean()` صدا می‌زند و `full_clean()` را فقط **فرم‌ها** (از جمله فرم پنل ادمین) صدا می‌زنند. `obj.save()` در shell، در API، یا در یک دستور مدیریتی هیچ‌وقت `clean()` را صدا نمی‌زند.

**راه حل پروژه:** قاعده در یک متد جدا (`apply_status_rules`) است که هر دو آن را صدا می‌زنند:
- `clean()` برای اینکه پنل ادمین خطا را **کنار همان فیلد** نشان دهد (`ValidationError({"field": ...})`).
- `save()` برای اینکه هیچ مسیر دیگری نتواند قاعده را دور بزند.

**بدون آن:** ادمین در فرم پیام خوب می‌دید، ولی کد دیگری می‌توانست درخواست «رد شده بدون دلیل» ذخیره کند.

**جایگزین ساده‌تر:** فقط `full_clean()` را در `save()` صدا بزنی. استفاده نشده، چون `full_clean()` همهٔ فیلدها و یکتایی‌ها را هم بررسی می‌کند. این کار query اضافه دارد و گاهی رفتار ناخواسته‌ای دارد (مثلاً روی فیلدهایی که عمداً بعداً پر می‌شوند).

همین الگو در `Account.normalize_fields`، `Book.apply_money_rules`، `TopUpRequest.apply_rules` و `WithdrawalRequest.apply_rules` هم هست.

### ۳.۲ قید دیتابیس به‌عنوان لایهٔ آخر

`save()` هم همیشه اجرا نمی‌شود. `QuerySet.update()`، `bulk_create()` و SQL خام مستقیم به دیتابیس می‌روند. برای همین مهم‌ترین قاعده‌ها یک قید (`constraint`) در `class Meta` هم دارند:

```python
# backend/catalog/models.py
models.CheckConstraint(
    condition=~Q(status="approved") | (Q(price__isnull=False) & Q(price__gte=F("seller_share"))),
    name="approved_book_price_covers_seller_share",
    violation_error_message=PRICE_BELOW_SELLER_SHARE,
),
```

این را در منطق بخوان: «یا کتاب تأییدشده نیست، **یا** قیمت دارد و قیمت ≥ سهم است». `~Q` یعنی NOT، `|` یعنی OR و `&` یعنی AND. `F("seller_share")` یعنی «مقدار ستون دیگر همین ردیف»، نه یک عدد ثابت. این قید در migration به یک `CHECK (...)` در خود PostgreSQL تبدیل می‌شود و دیتابیس هر INSERT یا UPDATE ناقض را رد می‌کند، از هر جا که آمده باشد.

`violation_error_message` فقط وقتی دیده می‌شود که Django خودش قید را در `full_clean()` بررسی کند (مثلاً در فرم ادمین). اگر دیتابیس رد کند، خطا `IntegrityError` است.

**قید شرطی یکتایی (partial unique index):**

```python
models.UniqueConstraint(
    fields=["isbn"],
    condition=~models.Q(status="rejected"),
    name="unique_isbn_unless_rejected",
)
```

«شابک یکتا باشد، **فقط** بین ردیف‌هایی که رد نشده‌اند.» یعنی یک کتاب تأییدشده یا در انتظار، به‌اضافهٔ هر تعداد کتاب ردشده با همان شابک. `unique=True` ساده این را نمی‌توانست، چون آن وقت کتاب ردشده هرگز قابل بارگذاری دوباره نبود. همین ترفند در `TopUpRequest.tracking_number`، «یک برداشت در انتظار برای هر کاربر» و «یک کیف پول مگابوک» به کار رفته.

**چیزی که قید نمی‌تواند:** «موجودی منفی نشود». موجودی جمع چند ردیف است و `CheckConstraint` فقط یک ردیف را می‌بیند. برای همین آن قاعده فقط در سرویس است (بخش ۷).

### ۳.۳ لایهٔ سرویس (`services.py`)

در چند اپ، منطق کسب‌وکار در `services.py` است، نه در view یا serializer: `book_requests`، `wallet`، `cart`، `orders` و `support`.

**چرا؟** view فقط HTTP را می‌فهمد (درخواست ← پاسخ). اگر قاعدهٔ «ثبت درخواست» در view بود، پنل ادمین یا یک دستور مدیریتی نمی‌توانست بدون جعل یک درخواست HTTP از آن استفاده کند. سرویس یک تابع پایتون معمولی است که هر کسی صدایش می‌زند.

الگوی نتیجه هم ثابت است: سرویس یک exception با کد ماشینی و پیام فارسی می‌دهد (`WalletError`، `CartError`، `CheckoutError`، `SupportError`) یا یک نتیجهٔ ساختاریافته برمی‌گرداند (`SubmitOutcome`). view آن را به کد HTTP مناسب تبدیل می‌کند. فرانت روی `code` شاخه می‌زند و `detail` یا `message` را نشان می‌دهد.

**جایگزین:** «fat models» (منطق روی متدهای مدل). برای عملیاتی که چند مدل را با هم تغییر می‌دهد (خرید: سفارش، کتابخانه، کیف پول و سبد) جای طبیعی‌ای روی هیچ مدلی ندارد.

### ۳.۴ تراکنش، قفل و savepoint

این سه مفهوم در کل پروژه با هم آمده‌اند. با یک مثال ساده‌شده از `backend/wallet/services.py` شروع کن:

```python
def create_withdrawal(user, amount, card_number):
    with transaction.atomic():                       # (1)
        wallet_id = wallet_of(user).pk
        wallet = _lock(wallet_id)[wallet_id]         # (2)
        if WithdrawalRequest.objects.filter(user=user, status=PENDING).exists():
            raise WalletError(PENDING_WITHDRAWAL_EXISTS)
        _check_can_change(wallet, -amount)           # (3)
        try:
            with transaction.atomic():               # (4)
                request = WithdrawalRequest.objects.create(...)
        except IntegrityError:
            raise WalletError(PENDING_WITHDRAWAL_EXISTS)
        LedgerEntry.objects.create(...)
```

1. **`transaction.atomic()`:** همه یا هیچ. اگر وسط کار exception بیاید، همهٔ تغییرات این بلوک برگردانده می‌شوند (rollback). بدون آن، ممکن بود درخواست برداشت ساخته شود ولی کسر پول ثبت نشود.
2. **`_lock`** یعنی `select_for_update()` که در SQL می‌شود `SELECT ... FOR UPDATE`. ردیف کیف پول تا پایان تراکنش قفل می‌شود و هر تراکنش دیگری که بخواهد همان ردیف را قفل کند **صبر می‌کند**. بدون قفل، دو برداشت ۸۰ هزارتومانی از موجودی ۱۰۰ هزار هر دو «۱۰۰» را می‌خواندند، هر دو موفق می‌شدند، و موجودی می‌شد ‎−۶۰.
3. موجودی **بعد از** قفل خوانده می‌شود. اگر قبل از قفل می‌خواندی، قفل بی‌فایده بود، چون عددی که خوانده‌ای ممکن است کهنه باشد.
4. **`atomic()` تودرتو یک savepoint است.** در PostgreSQL، وقتی یک دستور خطا بدهد (مثلاً قید یکتا)، **کل تراکنش** «شکسته» علامت می‌خورد و هر دستور بعدی هم خطا می‌دهد. savepoint یک نقطهٔ بازگشت داخلی است: فقط تا همان نقطه برمی‌گردد و تراکنش بیرونی سالم می‌ماند. هر جا در پروژه `try: with transaction.atomic(): ... except IntegrityError` دیدی، همین است: «قید دیتابیس آخرین نگهبان است؛ اگر رد کرد، خطای قابل‌فهم بده.»

**چرا قفل‌ها به ترتیب `id`؟** خرید چند کیف پول را قفل می‌کند (خریدار، فروشنده‌ها، مگابوک). اگر خرید اول A و بعد B را قفل کند و خرید دوم B و بعد A را، هر کدام منتظر دیگری می‌ماند و هیچ‌وقت تمام نمی‌شوند (**deadlock**). اگر همه همیشه به یک ترتیب قفل کنند، این دور ساخته نمی‌شود:

```python
def _lock(*wallet_ids):
    wallets = Wallet.objects.select_for_update().filter(pk__in=set(wallet_ids)).order_by("pk")
    return {w.pk: w for w in wallets}
```

`.order_by("pk")` همان ترتیب قفل است. Postgres ردیف‌ها را به ترتیب خواندنشان قفل می‌کند.

**قفل کردن ردیف کاربر** (`get_user_model().objects.select_for_update().filter(pk=user.pk).first()`) در `cart.services.add` و `orders.services.checkout` یک ترفند است: از ردیف کاربر فقط به‌عنوان «قفل این کاربر» استفاده می‌شود تا عملیات سبد و خرید یک کاربر پشت سر هم اجرا شوند. چرا کیف پول خریدار را قفل نکردند؟ چون کیف پول‌ها باید به ترتیب id قفل شوند و قفل زودهنگام کیف پول خریدار آن ترتیب را می‌شکست. توضیح کامل در docstring تابع `_lock_buyer` در `backend/orders/services.py` آمده.

### ۳.۵ «ذخیره نکن، حساب کن»

موجودی کیف پول، کمیسیون، جمع سفارش، تعداد درخواست‌کننده، تعداد پیام خوانده‌نشده، درآمد هر کتاب: هیچ‌کدام ستون ندارند و همیشه از دادهٔ اصلی حساب می‌شوند.

**چرا؟** عدد ذخیره‌شده می‌تواند با منبعش ناهماهنگ شود (باگ، هم‌زمانی، ویرایش دستی). عدد حساب‌شده نمی‌تواند. هزینه‌اش query است، که با `annotate` و `aggregate` در خود دیتابیس انجام می‌شود، نه با حلقهٔ پایتون (بخش ۱۰).

### ۳.۶ نرمال‌سازی در یک جا

`backend/accounts/phone.py`، `backend/catalog/isbn.py` و `backend/wallet/normalize.py` هر کدام تنها جایی‌اند که قاعدهٔ یک نوع داده تعریف شده. ورودی کاربر (رقم فارسی، خط تیره، فاصله، ‎+98) به یک شکل استاندارد تبدیل می‌شود و **فقط همان شکل** ذخیره و مقایسه می‌شود.

**بدون آن:** کاربری با `۰۹۱۲...` ثبت‌نام می‌کرد و با `+98912...` نمی‌توانست وارد شود. یا یک شمارهٔ پیگیری با دو شکل نوشتاری دو بار شارژ می‌شد.

یک ترفند کوچک در هر سه فایل:

```python
_LATIN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
```

`str.maketrans` یک جدول «این حرف ← آن حرف» می‌سازد و `.translate()` در یک حرکت همه را جایگزین می‌کند. هم رقم فارسی و هم رقم عربی (که شکلشان کمی فرق دارد و از کیبورد عربی می‌آید) پوشش داده شده.

### ۳.۷ پیام‌های فارسی خطا

پیام‌های پیش‌فرض DRF انگلیسی‌اند. برای همین تقریباً هر فیلد serializer `error_messages` دارد. در `backend/catalog/serializers.py` یک دیکشنری `MESSAGES` و تابع `messages(**overrides)` هست که پیام‌های مشترک را یک جا نگه می‌دارد.

یک جای جالب `persian_password_errors` در `backend/accounts/serializers.py` است. اعتبارسنج‌های رمز Django پیام انگلیسی دارند، ولی هر خطا یک `code` ثابت دارد (`password_too_short` و...). کد ترجمه را بر اساس **کد خطا** انتخاب می‌کند، نه متن انگلیسی، که با عوض شدن نسخهٔ Django عوض نمی‌شود. پارامترها (مثل `min_length`) هم به رقم فارسی تبدیل می‌شوند.

### ۳.۸ import داخل تابع

```python
# backend/catalog/models.py, inside Book.save()
from book_requests.services import sync_with_book
```

`book_requests` خودش `catalog.models` را import می‌کند. اگر `catalog.models` هم در بالای فایل `book_requests` را import می‌کرد، دو ماژول در حال بار شدن یکدیگر را می‌خواستند (**circular import**) و پایتون خطا می‌داد. import داخل تابع فقط وقتی اجرا می‌شود که تابع صدا زده شود، یعنی وقتی همهٔ ماژول‌ها بار شده‌اند.

**جایگزین:** سیگنال‌های Django (`post_save`). در `wallet/signals.py` برای «کیف پول برای کاربر تازه» از همین استفاده شده. برای `Book.save()` استفاده نشده، چون آنجا لازم است «وضعیت قبلی» را بدانیم، که سیگنال ندارد، و خواندن ترتیب کار در خود `save()` راحت‌تر است.

---

## ۴. `accounts`: کاربر و ورود

### ۴.۱ `Account` و `AccountManager` (`backend/accounts/models.py`)

```python
class Account(AbstractUser):
    username = None
    email = models.EmailField(unique=True, null=True, blank=True, ...)
    phone = models.CharField(max_length=11, unique=True, null=True, blank=True, ...)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]
    objects = AccountManager()
```

- **`username = None`** فیلد ارث‌رسیده از `AbstractUser` را حذف می‌کند.
- **`null=True` روی یک فیلد `unique`:** در SQL، `NULL` با `NULL` برابر نیست، پس هزار کاربر بی‌ایمیل مشکلی ندارند. ولی `""` (رشتهٔ خالی) با `""` برابر است و دومین کاربر بی‌ایمیل خطای یکتایی می‌گرفت. برای همین مقدار خالی همیشه به `None` تبدیل می‌شود. قید `account_email_not_empty_string` هم جلوی `""` را در دیتابیس می‌گیرد.
- **`USERNAME_FIELD = "email"`** با اینکه ایمیل اختیاری است؟ `createsuperuser` و پنل ادمین یک فیلد «شناسه» می‌خواهند. برای همین superuser و staff همیشه ایمیل دارند (`create_superuser` و `AccountUpdateSerializer` بررسی می‌کنند). ورود واقعی کاربران عادی از `IdentifierBackend` می‌گذرد که به این فیلد محدود نیست.
- **`class Meta(AbstractUser.Meta)`:** با ارث بردن از Meta والد، تنظیم‌هایی مثل `swappable` حفظ می‌شوند. اگر Meta را از صفر می‌نوشتی، `AUTH_USER_MODEL` درست کار نمی‌کرد.

**`AccountManager`:** Django برای ساختن کاربر از manager استفاده می‌کند (`Account.objects.create_user`). manager پیش‌فرض (`UserManager`) `username` می‌خواهد، پس یکی تازه لازم بود.
- `normalize_email` را بازنویسی کرده تا **کل** ایمیل را کوچک کند، نه فقط دامنه را، که کار پیش‌فرض Django است. بدون این، `Ali@x.com` و `ali@x.com` دو حساب جدا می‌شدند.
- `get_by_natural_key` را `createsuperuser` برای بررسی «این ایمیل گرفته شده؟» صدا می‌زند.
- `use_in_migrations = True` یعنی این manager در migrationها هم در دسترس است.
- `_create_user` در آخر `user.save()` را صدا می‌زند، که `normalize_fields()` را اجرا می‌کند (الگوی ۳.۱).

### ۴.۲ `IdentifierBackend` (`backend/accounts/backends.py`)

backend احراز هویت کلاسی است که `authenticate(...)` دارد و کاربر یا `None` برمی‌گرداند. Django همهٔ backendهای `AUTHENTICATION_BACKENDS` را به ترتیب امتحان می‌کند.

```python
def authenticate(self, request, identifier=None, password=None, username=None, **kwargs):
    if identifier is None:
        identifier = username if username is not None else kwargs.get(UserModel.USERNAME_FIELD)
    ...
    user = self.find_user(identifier)
    if check_password_with_timing_attack_mitigation(user, password) and self.user_can_authenticate(user):
        return user
    return None
```

- **سه نام برای یک چیز:** API ما `identifier` می‌فرستد. فرم ورود پنل ادمین `username` می‌فرستد. برخی ابزارهای Django با نام `USERNAME_FIELD` (`email`) می‌فرستند. خط اول هر سه را می‌پذیرد، برای همین پنل ادمین هم با موبایل کار می‌کند.
- **`check_password_with_timing_attack_mitigation`:** اگر کاربری پیدا نشد، باز هم یک رمز را hash می‌کند. hash کردن رمز عمداً کند است. اگر برای «کاربر نیست» زود جواب می‌دادیم و برای «رمز غلط» دیر، مهاجم با اندازه‌گیری زمان پاسخ می‌فهمید کدام ایمیل‌ها در سایت حساب دارند.
- **`user_can_authenticate`** از `ModelBackend` ارث رسیده و کاربر غیرفعال (`is_active=False`) را رد می‌کند. ارث بردن از `ModelBackend` (به‌جای `BaseBackend`) یعنی سیستم مجوزها (`has_perm`) هم دست‌نخورده می‌ماند. پنل ادمین برای staff غیر superuser به آن نیاز دارد.

### ۴.۳ Serializerها (`backend/accounts/serializers.py`)

**`RegisterSerializer.validate`:**

```python
user = Account(first_name=..., last_name=..., email=attrs.get('email'), phone=attrs.get('phone'))
try:
    validate_password(attrs['password'], user=user)
except DjangoValidationError as error:
    raise serializers.ValidationError({'password': persian_password_errors(error)})
```

یک کاربر **ذخیره‌نشده** فقط برای این ساخته می‌شود که `UserAttributeSimilarityValidator` بتواند رمز را با نام، ایمیل و موبایل مقایسه کند. بدون `user=...` این بررسی اصلاً اجرا نمی‌شد.

**`create` و `IntegrityError`:** `validate_email` بررسی می‌کند «این ایمیل گرفته شده؟». اگر دو نفر هم‌زمان با یک ایمیل ثبت‌نام کنند، هر دو از این بررسی رد می‌شوند (هنوز هیچ‌کدام ذخیره نشده). قید `unique` دیتابیس دومی را رد می‌کند و `except IntegrityError` آن را به پیام فارسی تبدیل می‌کند. این الگوی «بررسی در کد + قید در دیتابیس + ترجمهٔ IntegrityError» در کل پروژه تکرار شده.

**`email_field()` صریح:** اگر فیلد را صریح تعریف نکنی، `ModelSerializer` برای فیلد `unique` خودش یک `UniqueValidator` با پیام انگلیسی می‌گذارد. تعریف صریح آن را حذف می‌کند و بررسی یکتایی به `clean_email` می‌رود که **بعد از** نرمال‌سازی مقایسه می‌کند.

**`phone_field()` با `max_length=30`:** شمارهٔ ذخیره‌شده ۱۱ رقم است، ولی ورودی کاربر ممکن است `+98 912 345 6789` باشد. اگر حد ۱۱ بود، این ورودی پیش از رسیدن به نرمال‌سازی رد می‌شد.

**`AccountUpdateSerializer.validate`:** اگر ترکیب (ایمیل، موبایل) عوض شده باشد، `current_password` لازم است. دلیلش: کسی که فقط توکن را دزدیده (مثلاً با XSS) نباید بتواند ایمیل حساب را به خودش تغییر دهد و حساب را تصاحب کند. نام بدون رمز عوض می‌شود چون خطری ندارد.

**`LoginSerializer`:**

```python
class LoginSerializer(TokenObtainPairSerializer):
    username_field = 'identifier'
    default_error_messages = {'no_active_account': LOGIN_FAILED}

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = AccountSerializer(self.user).data
        return data
```

- `TokenObtainPairSerializer` فیلد ورودی را از `username_field` می‌سازد و آن را با همان نام به `authenticate(identifier=...)` می‌دهد. همین خط باعث می‌شود simplejwt با backend ما کار کند.
- `super().validate()` احراز هویت را انجام می‌دهد و `{refresh, access}` برمی‌گرداند. ما فقط اطلاعات کاربر را اضافه می‌کنیم تا فرانت یک درخواست اضافه برای گرفتن آن نزند.

### ۴.۴ Viewها (`backend/accounts/views.py`)

- **`RegisterView.authentication_classes = []`:** ظریف است. اگر مرورگر هنوز یک توکن **منقضی** در هدر بفرستد، `JWTAuthentication` **پیش از** بررسی اجازه خطای 401 می‌دهد، حتی برای viewی با `AllowAny`. خالی کردن کلاس‌های احراز هویت یعنی «این view اصلاً به هدر نگاه نکند». `LoginView` لازم ندارد، چون `TokenViewBase` در simplejwt خودش `authentication_classes = ()` دارد. `CategoryListView` در `catalog` هم همین ترفند را دارد.
- **`MeView.http_method_names`:** `RetrieveUpdateAPIView` هم PUT دارد و هم PATCH. PUT یعنی «همهٔ فیلدها را بفرست»، که اینجا معنا ندارد، پس حذف شده.
- **`MeView.update`** پاسخ را با `AccountSerializer` می‌سازد، نه با serializer ویرایش، تا شکل پاسخ دقیقاً همان GET باشد و فرانت بتواند state خودش را با آن جایگزین کند.
- **`ChangePasswordView`:** JWT «بی‌حالت» (stateless) است: سرور توکن را از روی امضا می‌پذیرد و جایی ثبتش نمی‌کند. پس چطور «همهٔ دستگاه‌ها را خارج کن»؟ اپ `token_blacklist` هر refresh صادرشده را در `OutstandingToken` ثبت می‌کند. این view همه را به `BlacklistedToken` اضافه می‌کند. access tokenهای فعلی تا ۳۰ دقیقه معتبر می‌مانند، چون آن‌ها هیچ‌جا چک نمی‌شوند، ولی بعد از آن دیگر refresh نمی‌شوند.

---

## ۵. `catalog`: کتاب، بارگذاری، فایل خصوصی

### ۵.۱ `Book.save()` (`backend/catalog/models.py`)

```python
def save(self, *args, **kwargs):
    self.apply_money_rules()
    adding = self._state.adding or self.pk is None
    previous = None
    if not adding:
        previous = type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
    with transaction.atomic():
        super().save(*args, **kwargs)
        if (adding and self.status == self.Status.APPROVED) or (previous is not None and previous != self.status):
            from book_requests.services import sync_with_book
            sync_with_book(self, previous)
        if previous is not None and previous != self.status:
            from support.services import on_book_status_changed
            on_book_status_changed(self, previous)
```

خط به خط:
- **`self._state.adding`** پرچم Django است برای «این شیء هنوز در دیتابیس نیست».
- **`previous`:** شیء پایتونی در حافظه وضعیت **تازه** را دارد. برای فهمیدن «وضعیت عوض شد؟» باید مقدار ذخیره‌شده را از دیتابیس بخوانیم. `values_list("status", flat=True).first()` فقط همان یک ستون را می‌خواند، نه کل ردیف را.
- **`atomic()`:** ذخیرهٔ کتاب و اثرهای جانبی‌اش با هم انجام می‌شوند یا هیچ‌کدام. اگر ساختن پیام سیستمی خطا بدهد، تأیید کتاب هم برمی‌گردد.
- **دو اثر جانبی:**
  - `sync_with_book`: درخواست کتاب همان شابک را «تأمین شده» یا «باز» می‌کند (بخش ۶.۳).
  - `on_book_status_changed`: برای بارگذارنده پیام سیستمی می‌فرستد.
  - چون در `save()` هستند، از **هر** مسیری اجرا می‌شوند: پنل ادمین، shell یا `seed_books`.
- **بدون این:** ادمین کتاب را تأیید می‌کرد و ده نفری که درخواستش داده بودند هیچ‌وقت خبردار نمی‌شدند.
- **دام:** `Book.objects.filter(...).update(status="approved")` هیچ‌کدام از این‌ها را اجرا نمی‌کند (بخش ۱۵).

### ۵.۲ `active_for_isbn` و `can_download_file`

```python
@classmethod
def active_for_isbn(cls, isbn):
    return cls.objects.exclude(status=cls.Status.REJECTED).filter(isbn=isbn).only("id", "status").first()
```

تنها تعریف «این شابک در مگابوک هست؟». فرم بارگذاری، جستجوی شابک و ثبت درخواست همه از همین استفاده می‌کنند. اگر هر کدام query خودشان را می‌نوشتند، یکی ممکن بود کتاب ردشده را هم حساب کند و رفتار سایت جاهای مختلف ناهماهنگ می‌شد. `.only(...)` فقط همین دو ستون را می‌خواند.

`can_download_file(user)` تنها پاسخ به «این کاربر می‌تواند فایل کامل را بگیرد؟» است:
- staff: همیشه.
- بارگذارنده: فقط وقتی کتاب تأییدشده است.
- خریدار: همیشه، حتی اگر کتاب بعداً از فروشگاه برداشته شود.

هر دو مسیر دانلود (گرفتن لینک و خود دانلود) این را صدا می‌زنند.

### ۵.۳ `ownership.py`: «مالکیت» در SQL

```python
def owned_q(user):
    in_library = LibraryItem.objects.filter(user=user, book=OuterRef("pk"))
    return Q(uploaded_by=user) | Q(Exists(in_library))
```

- **`OuterRef("pk")`** یعنی «pk ردیفی از query بیرونی که الان بررسی می‌شود». این یک **subquery همبسته** است: برای هر کتاب می‌پرسد «ردیفی در کتابخانهٔ این کاربر برای این کتاب هست؟».
- **`Exists(...)`** به `EXISTS (SELECT ...)` تبدیل می‌شود که به محض پیدا کردن یک ردیف متوقف می‌شود.
- **چرا نه `Q(library_items__user=user)`؟** این شکل یک JOIN با جدول کتابخانه می‌سازد. JOIN برای هر خریدار کتاب یک ردیف می‌سازد، پس کتابی که ده نفر خریده‌اند ده بار در نتیجه می‌آمد. `Exists` ردیف تکراری نمی‌سازد.

```python
def annotate_is_owned(queryset, user):
    if user is None or not user.is_authenticated:
        return queryset.annotate(is_owned=Value(False, output_field=BooleanField()))
    return queryset.annotate(
        is_owned=Case(When(owned_q(user), then=Value(True)), default=Value(False), output_field=BooleanField())
    )
```

`annotate` یک ستون محاسبه‌شده به هر ردیف اضافه می‌کند. `Case/When` همان `CASE WHEN ... THEN ... ELSE ... END` در SQL است. نتیجه این است که برای ۲۰ کتاب یک صفحه، `is_owned` با **یک** query حساب می‌شود، نه ۲۰ query (مشکل N+1، واژه‌نامه را ببین). برای مهمان، ثابت `False` برمی‌گردد چون مهمان هیچ کتابی ندارد.

### ۵.۴ `BookCreateSerializer` (`backend/catalog/serializers.py`)

پیچیده‌ترین serializer پروژه است. تکه به تکه:

**`__init__`: فیلد پول بسته به نقش**

```python
def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    request = self.context.get("request")
    if request is not None and request.user.is_staff:
        self.fields["seller_share"].read_only = True
    else:
        self.fields["price"].read_only = True
```

کاربر عادی `seller_share` (سهم پیشنهادی خودش) را می‌فرستد و ادمین `price` را. فیلد `read_only` در ورودی **نادیده** گرفته می‌شود (حتی اگر کلاینت بفرستد)، ولی در پاسخ برمی‌گردد. پس فرانت هرگز تعیین نمی‌کند کدام فیلد پول ثبت شود. نقش کاربر در سرور تعیین می‌کند. بدون این، یک کاربر عادی می‌توانست با فرستادن `price` قیمت فروشگاه را خودش تعیین کند. `self.context["request"]` را `GenericAPIView.get_serializer()` خودش می‌گذارد.

**`to_internal_value`: خطای «جلد لازم است» همراه بقیهٔ خطاها**

```python
def to_internal_value(self, data):
    errors = {}
    try:
        value = super().to_internal_value(data)
    except serializers.ValidationError as exc:
        errors = dict(exc.detail)
    if not data.get("cover") and not data.get("cover_url"):
        errors.setdefault("cover", [COVER_REQUIRED])
    if errors:
        raise serializers.ValidationError(errors)
    return value
```

ترتیب اعتبارسنجی DRF این است: `to_internal_value` (که `validate_<field>` هر فیلد را صدا می‌زند) ← `validate(attrs)`. **`validate()` فقط وقتی اجرا می‌شود که همهٔ فیلدها بدون خطا باشند.** اگر «یکی از `cover` یا `cover_url` لازم است» در `validate()` بود، کاربری که هم عنوان را خالی گذاشته و هم جلد را، اول فقط خطای عنوان را می‌دید و بعد از درست کردنش تازه خطای جلد را. با این بازنویسی، خطای جلد کنار بقیه برمی‌گردد و فرم همه را با هم نشان می‌دهد. فرم به اولین خطا اسکرول می‌کند و ترتیب `Meta.fields` همان ترتیب مراحل فرم است.

**`validate`: دانلود جلد قبل از ذخیره**

```python
def validate(self, attrs):
    cover_url = attrs.pop("cover_url", "")
    if attrs.get("cover"):
        return attrs
    try:
        attrs["cover"] = download_cover(cover_url, attrs["isbn"])
    except CoverDownloadError:
        raise serializers.ValidationError({"cover": [COVER_DOWNLOAD_FAILED]})
    return attrs
```

- `cover_url` ستون مدل نیست. باید از `attrs` برداشته شود (`pop`)، وگرنه `Book.objects.create(**attrs)` با «فیلد ناشناخته» خطا می‌داد.
- دانلود در `validate` است، نه `create`، تا اگر شکست بخورد، خطا مثل یک خطای فرم معمولی برگردد و هیچ چیزی ساخته نشود.
- `download_cover` یک `ContentFile` برمی‌گرداند که `ImageField` آن را مثل فایل آپلودشده ذخیره می‌کند.

**`is_pdf`: پسوند و امضای فایل**

```python
def is_pdf(file):
    if not file.name.lower().endswith(".pdf"):
        return False
    head = file.read(5)
    file.seek(0)
    return head == b"%PDF-"
```

هر فایل PDF با بایت‌های `%PDF-` شروع می‌شود (magic number). تغییر پسوند یک فایل `.exe` به `.pdf` آسان است، ولی جعل محتوا سخت‌تر. **`file.seek(0)` حیاتی است:** بعد از خواندن ۵ بایت، «نشانگر خواندن» جلو رفته. اگر برنمی‌گشت، فایل ذخیره‌شده از بایت ششم شروع می‌شد، یعنی خراب.

**`create`:**
- **فیلدهای غیرستونی را جدا کن:** نویسنده‌ها و ناشر نام‌اند، نه شیء. با `get_or_create(name=...)` پیدا یا ساخته می‌شوند.
- **رابطه‌های چندبه‌چند بعد از ذخیره:** `book.authors.set(...)` به `book.id` نیاز دارد، چون هر ردیف جدول واسط `(book_id, person_id)` است.
- **کتاب ادمین:** `seller_share = 0` و `status = APPROVED` همین‌جا تنظیم می‌شوند. چون ادمین حتماً `price` فرستاده (فیلد اجباری است)، قاعدهٔ پول برقرار است.
- **`except IntegrityError`:** دو بارگذاری هم‌زمان یک شابک هر دو از `validate_isbn` رد می‌شوند. قید `unique_isbn_unless_rejected` دومی را رد می‌کند و پیام بر اساس وضعیت کتابی که «برنده» شده انتخاب می‌شود.

**`to_representation`:** پاسخ پیش‌فرض برای رابطه‌ها id برمی‌گرداند. این متد نام‌ها را برمی‌گرداند، همان شکلی که کلاینت فرستاده بود.

### ۵.۵ Serializerهای عمومی و views

- **فهرست صریح `fields`** در `BookListSerializer` و `BookDetailSerializer`. هرگز `"__all__"` نیست، چون آن وقت `book_file` (محتوای پولی) و `seller_share` (که با آن هر کس کمیسیون را حساب می‌کند) در API عمومی می‌آمدند. اگر روزی ستونی اضافه کنی، با فهرست صریح امن می‌ماند.
- **`BookDetailSerializer(BookListSerializer)`** با `Meta(BookListSerializer.Meta)` فیلدهای فهرست را ارث می‌برد و `fields = BookListSerializer.Meta.fields + [...]` فقط اضافه‌ها را می‌نویسد.
- **`get_file_size`** با `try/except OSError`: اگر فایل روی دیسک گم شده باشد، `book_file.size` خطا می‌دهد. بدون این، کل صفحهٔ کتاب 500 می‌داد. حالا فقط `null` برمی‌گردد.
- **`approved_books()`** در `views.py` تنها تعریف «کتاب قابل نمایش» است. `order_by("-created_at", "-id")`: اگر دو کتاب `created_at` یکسان داشته باشند (مثلاً در `seed_books`)، بدون `-id` ترتیبشان بین دو درخواست ممکن بود عوض شود و یک کتاب در صفحهٔ ۱ و ۲ تکرار شود یا جا بیفتد.
- **`select_related("category")` و `prefetch_related("authors")`:** واژه‌نامه را ببین. هر رابطه‌ای که serializer نشان می‌دهد باید این‌جا پیش‌واکشی شود.
- **`perform_create`** با `serializer.save(uploaded_by=self.request.user)`: بارگذارنده از توکن می‌آید، نه از بدنهٔ درخواست. کلاینت نمی‌تواند به نام کس دیگری کتاب بگذارد.
- **`IsbnLookupView`** وضعیت شابک در مگابوک (`already_exists`، `existing_status`، `book_id`) را در **هر سه** پاسخ (200، 404، 502) می‌دهد. حتی اگر Open Library قطع باشد، فرم می‌فهمد این کتاب از قبل هست.

### ۵.۶ فایل خصوصی (`backend/MegaBook_Backend/private_files.py`)

مسئله: فایل کامل کتاب پولی است. فایل‌هایی که در `MEDIA_ROOT` ذخیره شوند آدرس عمومی `/media/...` دارند و هر کس آدرس را داشته باشد بازشان می‌کند.

**لایهٔ ۱: storage بدون URL**

```python
class PrivateStorage(FileSystemStorage):
    @property
    def base_location(self):
        return settings.PRIVATE_MEDIA_ROOT
    ...
    def url(self, name):
        raise ValueError("Private files have no public URL; use a signed link (private_files.make_link).")
```

- `base_location` یک **property** است، نه مقداری که یک بار هنگام import خوانده شود. برای همین `test_runner.py` می‌تواند مسیر را در تست‌ها عوض کند.
- `url()` خطا می‌دهد. اگر کسی اشتباهاً `book_file` را در یک serializer بگذارد، به‌جای لو رفتن آدرس، خطا می‌گیرد.

```python
_private_storage = PrivateStorage()

def private_storage():
    return _private_storage
```

**چرا یک تابع؟** وقتی به فیلد `storage=` می‌دهی، `makemigrations` باید آن را در فایل migration بنویسد. اگر خود شیء را بدهی، Django سعی می‌کند تنظیماتش را serialize کند. تابع فقط به‌شکل «ارجاع به `private_files.private_storage`» نوشته می‌شود.

**لایهٔ ۲: نام تصادفی**

```python
@deconstructible
class RandomName:
    def __init__(self, folder): self.folder = folder
    def __call__(self, instance, filename):
        ext = os.path.splitext(filename)[1].lower()
        return f"{self.folder}/{uuid.uuid4().hex}{ext}"
    def __eq__(self, other):
        return isinstance(other, RandomName) and other.folder == self.folder
```

- `upload_to` می‌تواند یک callable باشد که نام فایل را می‌سازد. اگر نام از شابک ساخته می‌شد، حدس‌زدنی بود.
- `@deconstructible` به Django یاد می‌دهد این شیء را در migration چطور بنویسد (نام کلاس به‌اضافهٔ آرگومان‌ها).
- `__eq__` لازم است چون `makemigrations` فیلد فعلی را با فیلد migration قبلی مقایسه می‌کند. بدون `__eq__`، دو شیء `RandomName` با محتوای یکسان «متفاوت» حساب می‌شدند و **هر بار** یک migration بی‌معنی ساخته می‌شد.

**لایهٔ ۳: لینک امضاشده**

مشکل این است که احراز هویت با هدر `Authorization` کار می‌کند، و `<iframe src>` یا `<a href>` نمی‌تواند هدر بفرستد. راه حل دو مرحله دارد:

```python
def make_link(request, kind, url_name, obj_pk, user):
    token = _signer(kind).sign_object({"o": obj_pk, "u": user.pk})
    url = request.build_absolute_uri(reverse(url_name, args=[obj_pk]))
    return {"url": f"{url}?t={token}", "expires_in": settings.PRIVATE_FILE_LINK_SECONDS}
```

1. فرانت با axios (که JWT دارد) از `/file-link/` یک لینک می‌گیرد.
2. لینک یک توکن دارد که با `SECRET_KEY` امضا شده و می‌گوید «شیء o برای کاربر u».

`TimestampSigner` زمان امضا را هم داخل توکن می‌گذارد. `unsign_object(token, max_age=300)` توکن جعلی، دست‌کاری‌شده یا قدیمی‌تر از ۵ دقیقه را رد می‌کند.

```python
def _signer(kind):
    return signing.TimestampSigner(salt=f"megabook.private-file.{kind}")
```

**salt جدا برای هر نوع:** توکنی که برای رسید شمارهٔ ۷ ساخته شده، برای کتاب شمارهٔ ۷ معتبر نیست، چون امضایش با salt دیگری ساخته شده.

```python
def download_user(request, kind, obj_pk):
    if request.user.is_authenticated and request.user.is_staff:
        return request.user
    return user_from_token(kind, request.GET.get("t"), obj_pk)
```

view دانلود یک view معمولی Django است، نه DRF، پس `request.user` از **session** می‌آید. ادمینی که در پنل وارد شده بدون توکن رد می‌شود و لینک «مشاهده» در پنل همین‌طور کار می‌کند. بعد از پیدا کردن کاربر، `can_download_file` **دوباره** بررسی می‌شود، چون کاربر ممکن است در آن ۵ دقیقه دسترسی‌اش را از دست داده باشد.

**`file_response`** دو حالت دارد:
- با `PRIVATE_MEDIA_ACCEL_PREFIX`: فقط هدر `X-Accel-Redirect` برمی‌گردد و nginx فایل را می‌فرستد. Django برای فایل‌های بزرگ کند است.
- بدون آن: `FileResponse` فایل را جریانی (stream) می‌فرستد.

`Cache-Control: private, no-store` جلوی ذخیرهٔ فایل در cache مرورگر یا proxy را می‌گیرد. `_content_disposition` دو نام می‌گذارد: `filename*=UTF-8''...` برای عنوان فارسی و یک `filename="download.pdf"` ASCII برای مرورگرهای قدیمی.

**`@xframe_options_exempt` روی `book_file_view`:** Django به‌طور پیش‌فرض هدر `X-Frame-Options: DENY` می‌گذارد که نمایش صفحه در `<iframe>` سایت دیگر را ممنوع می‌کند (محافظت در برابر clickjacking). صفحهٔ خواندن PDF را در iframe روی `:5173` نشان می‌دهد که origin دیگری است. فقط همین یک view معاف شده، چون PDF دکمه‌ای برای کلیک فریبنده ندارد.

**`PrivateFileInput`** (ویجت پنل ادمین): ویجت پیش‌فرض فایل در ادمین لینک «فایل فعلی» را با `file.url` می‌سازد، که برای فایل خصوصی خطا می‌دهد (لایهٔ ۱). این ویجت به‌جایش به view دانلود لینک می‌دهد. `BookAdmin.get_form` آن را با آدرس همان کتاب می‌سازد.

### ۵.۷ `book_sources`: Open Library

- **`__init__.py`** یک لایهٔ انتزاعی است: view فقط `lookup_isbn` و `SourceUnavailable` را می‌شناسد. `SOURCES` فهرست تابع‌های `fetch` است که به ترتیب امتحان می‌شوند. برای منبع دوم، فقط یک ماژول اضافه می‌کنی.
- **سه نتیجهٔ متفاوت:** `dict` (پیدا شد)، `None` (منبع سالم است و این شابک را ندارد)، `SourceUnavailable` (منبع جواب نداد). فرق «پیدا نشد» (404) و «در دسترس نیست» (502) برای کاربر مهم است: در حالت دوم شاید بعداً پیدا شود.
- **`timeout=5`** در `requests.get`. بدون timeout، اگر Open Library کند باشد، worker سرور ما تا ابد منتظر می‌ماند.
- **`_to_book_fields`** و توابع کمکی‌اش (`_text`، `_names`، `_positive_int`) با جواب Open Library **بدبینانه** رفتار می‌کنند: هر فیلد ممکن است نباشد یا نوعش غلط باشد. `isinstance(value, int) and not isinstance(value, bool)` چون در پایتون `True` هم int است.

**`download_cover` و SSRF.** این یکی دقیق است. SSRF (Server-Side Request Forgery) یعنی مهاجم سرور تو را وادار می‌کند آدرسی را درخواست کند که خودش به آن دسترسی ندارد. `cover_url` از کلاینت می‌آید. اگر هر آدرسی دانلود می‌شد، می‌شد `http://db:5432` یا `http://169.254.169.254/` (سرویس metadata ابری که کلید دسترسی برمی‌گرداند) فرستاد. دفاع چند لایه است:

```python
for hop in range(COVER_MAX_REDIRECTS + 1):
    _check_cover_url(current, first=(hop == 0))
    ...
    response = requests.get(current, timeout=remaining, stream=True, allow_redirects=False)
    if response.status_code in _REDIRECT_CODES:
        current = urljoin(current, response.headers.get("Location"))
        continue
```

- **`_check_cover_url`:** فقط `https`، بدون user:pass در آدرس (`https://covers.openlibrary.org@evil.com/` در واقع به `evil.com` می‌رود)، فقط پورت 443، قدم اول حتماً `covers.openlibrary.org`، و بقیه فقط `archive.org` و زیردامنه‌هایش. `host.endswith(".archive.org")` با نقطه است تا `evilarchive.org` قبول نشود.
- **`allow_redirects=False`:** اگر `requests` خودش redirect را دنبال می‌کرد، آدرس اول مجاز بود ولی جواب می‌توانست بگوید «برو به `http://127.0.0.1/`» و ما هرگز آن را بررسی نمی‌کردیم. پس هر قدم را خودمان بررسی می‌کنیم.
- **`stream=True` و `_read_limited`:** بدنه را تکه‌تکه می‌خواند و از ۵ MB که بگذرد متوقف می‌شود. به `Content-Length` اعتماد نمی‌کند (می‌تواند دروغ باشد).
- **مهلت کل (`deadline`):** `timeout` در `requests` برای «هر بار انتظار» است. سروری که هر ۴ ثانیه یک بایت بفرستد، بدون مهلت کل هرگز timeout نمی‌شد.
- **`_to_image_file`:** با Pillow باز می‌شود، چون به پسوند یا `Content-Type` اعتماد نمی‌کنیم. `DecompressionBombWarning` به خطا تبدیل می‌شود. «بمب فشرده‌سازی» تصویری است که فایلش کوچک است ولی باز شده‌اش گیگابایت‌ها حافظه می‌خورد.

### ۵.۸ `seed_books`

- `handle()` عمداً superuser نمی‌سازد و بدون آن متوقف می‌شود: ساختن حساب مدیر و رمزش تصمیم انسان است.
- `check_data()` **قبل از** نوشتن هر چیزی کل داده را بررسی می‌کند. اگر کتاب نهم غلط تایپی داشت، هشت کتاب نیمه‌کاره در دیتابیس نمی‌ماندند.
- `@transaction.atomic` روی `create_book`: هر کتاب در تراکنش خودش ساخته می‌شود.
- `make_password(None)` یک رمز «غیرقابل‌استفاده» برای کاربر نمونه می‌سازد. هیچ رمزی با آن جور نمی‌شود.
- **شکل دادن به متن فارسی** (`shape_persian`): Pillow بدون کتابخانهٔ سیستمی `libraqm` حروف فارسی را جدا و چپ‌به‌راست می‌کشد. کد هر حرف را به «شکل نمایشی» درستش (تنها، اول، وسط، آخر) از بلوک یونیکد Arabic Presentation Forms تبدیل می‌کند و ترتیب را برعکس می‌کند. فقط برای عنوان‌های کوتاه جلد نمونه کافی است.

---

## ۶. `book_requests`: درخواست کتاب

### ۶.۱ دو جدول برای یک مفهوم

`BookRequest` (یکی برای هر شابک) و `RequestEntry` (یکی برای هر کاربر درخواست‌کننده). اگر ده نفر یک کتاب بخواهند، یک تصمیم ادمین لازم است، نه ده تصمیم که ممکن است با هم ناهماهنگ شوند. `RequestEntry` قید یکتای `(request, requester)` دارد.

### ۶.۲ `submit_request` (`backend/book_requests/services.py`)

```python
with transaction.atomic():
    book = Book.active_for_isbn(isbn)
    if book and book.status == Book.Status.APPROVED:
        return SubmitOutcome(AVAILABLE, book_id=book.id)
    if book and book.status == Book.Status.PENDING:
        return SubmitOutcome(IN_REVIEW)

    book_request, _created = BookRequest.objects.select_for_update().get_or_create(
        isbn=isbn,
        defaults={"title": title, "authors": authors, "cover_url": cover_url},
    )
    if require_open and book_request.status != BookRequest.Status.OPEN:
        return SubmitOutcome(NOT_OPEN)
    ...
```

- **`get_or_create` در هم‌زمانی:** دو کاربر هم‌زمان یک شابک تازه می‌فرستند و هر دو «پیدا نشد» می‌بینند و INSERT می‌کنند. قید `unique` دومی را رد می‌کند. خود `get_or_create` این `IntegrityError` را داخل یک savepoint می‌گیرد و ردیفی را که اولی ساخته برمی‌گرداند. پس هرگز دو `BookRequest` برای یک شابک ساخته نمی‌شود.
- **`select_for_update()` قبل از `get_or_create`:** اگر ردیف از قبل باشد، قفل می‌شود. بین «وضعیتش باز است» و «RequestEntry بساز»، ادمین نمی‌تواند آن را رد کند.
- **`defaults`** فقط هنگام ساختن استفاده می‌شود. اطلاعات اولین درخواست‌کننده می‌ماند.
- **پاسخ یکسان برای «تازه» و «پیوستن»:** هر دو `REQUESTED` برمی‌گردانند و پاسخ API نه id دارد نه تعداد. وگرنه از روی پاسخ معلوم می‌شد کس دیگری قبلاً این کتاب را خواسته.
- **`SubmitOutcome`** یک `@dataclass` است، یعنی یک کلاس سادهٔ داده که `__init__` خودکار دارد. به‌جای برگرداندن tuple بی‌نام.

### ۶.۳ `sync_with_book`

`Book.save()` صدایش می‌زند (بخش ۵.۱).
- کتاب تأیید شد ← درخواست **باز** همان شابک «تأمین شده» می‌شود.
- کتاب از حالت تأییدشده خارج شد و کتاب تأییدشدهٔ دیگری با همان شابک نیست ← «تأمین شده» دوباره «باز» می‌شود.
- درخواست **رد شده** هرگز دست نمی‌خورد، چون آن تصمیم ادمین بوده.

تغییر از طریق `book_request.save()` انجام می‌شود، پس پیام‌های سیستمی هم فرستاده می‌شوند. زنجیرهٔ کامل: `Book.save` ← `sync_with_book` ← `BookRequest.save` ← `on_request_status_changed` ← پیام برای هر درخواست‌کننده. همهٔ این‌ها در یک تراکنش‌اند.

### ۶.۴ View

- **`open_requests(user)`:** سه ستون محاسبه‌شده در **یک** query:
  - `Count("entries")` (یک JOIN و GROUP BY)
  - `is_mine` با `Exists`
  - `book_in_review` با `Exists` روی کتاب‌های در انتظار همان شابک (`OuterRef("isbn")`، نه pk)
- **جستجوی شابک با رقم فارسی:** `to_latin_digits` و حذف خط تیره، و فقط اگر نتیجه تماماً عدد بود، `isbn__contains` اضافه می‌شود.
- **کد 409 Conflict:** یعنی «ورودی‌ات درست بود، ولی وضعیت فعلی داده‌ها اجازه نمی‌دهد». با 400 (ورودی غلط) فرق دارد و فرانت می‌تواند جدا رفتار کند.
- **`JoinRequestView`** همان `submit_request` را با `require_open=True` صدا می‌زند تا قاعده‌ها یک جا بمانند. بعد از موفقیت، کارت به‌روزشده را **از دیتابیس** می‌خواند (`open_requests(...).filter(pk=pk)`)، نه اینکه تعداد را در پایتون یکی زیاد کند.

### ۶.۵ `fulfil_requests_on_sale`

دستور مدیریتی یکباره برای داده‌ای که قبل از اضافه شدن `sync_with_book` ساخته شده. `--dry-run` با `parser.add_argument(..., action="store_true")` تعریف شده: فقط فهرست را نشان می‌دهد و چیزی را عوض نمی‌کند. هر ردیف با `save()` تغییر می‌کند، **نه** `update()`، تا پیام‌ها فرستاده شوند.

### ۶.۶ ادمین

`has_delete_permission` همیشه `False` است، چون حذف درخواست با CASCADE همهٔ `RequestEntry`ها و گفت‌وگوها را پاک می‌کرد. `get_queryset` با `annotate(requester_count=Count("entries"))` تعداد را در همان query فهرست حساب می‌کند. `ordering="requester_count"` در `@admin.display` ستون را قابل مرتب‌سازی می‌کند.

---

## ۷. `wallet`: دفتر پول

دقیق‌ترین بخش پروژه است. اول الگوهای ۳.۴ را بخوان.

### ۷.۱ چرا ستون «موجودی» نداریم

`LedgerEntry` یک دفتر حسابداری است: هر ردیف یک جابه‌جایی پول است (مثبت ورود، منفی خروج) و موجودی برابر `SUM(amount)` است:

```python
def balance_of(wallet):
    return LedgerEntry.objects.filter(wallet=wallet).aggregate(
        total=Coalesce(Sum("amount"), Value(0), output_field=BigIntegerField())
    )["total"]
```

`SUM` روی صفر ردیف `NULL` برمی‌گرداند، نه ۰. `Coalesce(..., 0)` یعنی «اگر NULL بود، ۰». `output_field` لازم است چون Django نمی‌تواند نوع خروجی ترکیب `Sum` و `Value` را خودش حدس بزند.

**جایگزین ساده‌تر:** ستون `balance` با `F("balance") - amount`. استفاده نشده چون تاریخچه («این پول از کجا آمد؟») از بین می‌رفت و یک باگ می‌توانست موجودی را بی‌صدا خراب کند (DECISIONS ۶.۱).

### ۷.۲ تغییرناپذیری در سه لایه

```python
class LedgerEntryQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ImmutableLedgerError(...)
    def delete(self):
        raise ImmutableLedgerError(...)

class LedgerEntry(models.Model):
    objects = LedgerEntryQuerySet.as_manager()
    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ImmutableLedgerError(...)
        super().save(*args, **kwargs)
    def delete(self, *args, **kwargs):
        raise ImmutableLedgerError(...)
```

- `save()` و `delete()` روی **یک** شیء.
- **custom QuerySet:** `LedgerEntry.objects.filter(...).update(...)` و `.delete()` گروهی از `save()` و `delete()` شیء رد نمی‌شوند. باید خود QuerySet را بازنویسی کرد. `as_manager()` از یک QuerySet سفارشی یک manager می‌سازد تا `LedgerEntry.objects` همین رفتار را داشته باشد.
- در پنل ادمین `has_change_permission` و `has_delete_permission` همیشه `False` هستند.

اشتباه با یک ردیف **جبرانی** (`adjustment`) درست می‌شود و تاریخچه همیشه کامل می‌ماند. همین الگو در `orders` (`ImmutableModel`) و `support` (`Message`) تکرار شده.

### ۷.۳ قیدهای `LedgerEntry`

قیدها در `Meta.constraints` قاعده‌های «علامت با نوع جور است» و «هر نوع پیوند درست خودش را دارد» را در دیتابیس اجرا می‌کنند. چند تا را بخوان:

```python
models.UniqueConstraint(fields=["topup_request"], name="ledger_one_entry_per_topup_request"),
models.UniqueConstraint(fields=["order"], name="ledger_one_debit_per_order"),
```

«هر درخواست شارژ حداکثر یک ردیف در دفتر» یعنی حتی اگر باگی `approve_topup` را دو بار صدا بزند، دیتابیس دومی را رد می‌کند و پول دو برابر نمی‌شود. به این خاصیت **idempotency** می‌گویند (تکرار یک کار نتیجه را عوض نمی‌کند). `NULL`ها در یکتایی حساب نمی‌شوند، پس ردیف‌هایی که `topup_request` ندارند با هم برخوردی ندارند.

### ۷.۴ سرویس‌ها

**`approve_topup`:**

```python
with transaction.atomic():
    request = _locked_request(TopUpRequest, request)   # lock + check status is pending
    wallet = _lock(wallet_id)[wallet_id]
    request.status = APPROVED; ...; request.save()
    return LedgerEntry.objects.create(..., topup_request=request)
```

`_locked_request` ردیف درخواست را **دوباره** از دیتابیس می‌خواند و قفل می‌کند. اگر دو ادمین هم‌زمان «تأیید» بزنند، دومی منتظر می‌ماند و بعد می‌بیند وضعیت دیگر «در انتظار» نیست. ترتیب قفل ثابت است: اول درخواست، بعد کیف پول.

**`create_withdrawal`:** کسر **هنگام ساختن** درخواست، نه هنگام پرداخت. وگرنه کاربر در فاصلهٔ درخواست تا پرداخت ادمین می‌توانست همان پول را خرج کتاب کند و موجودی منفی می‌شد.

**`_check_can_change`:**

```python
def _check_can_change(wallet, change):
    if wallet.kind == Wallet.Kind.USER and balance_of(wallet) + change < 0:
        raise WalletError(INSUFFICIENT_BALANCE, "amount")
```

تنها جایی است که «موجودی منفی نشود» اجرا می‌شود. کیف پول مگابوک معاف است. برای همین «فقط `services.py` تراکنش می‌سازد» یک قاعدهٔ واقعی است و یک تست کل کد پروژه را برای آن بررسی می‌کند.

**`transfer(legs)`: حسابداری دوطرفه**

```python
if sum(leg.amount for leg in legs) != 0:
    raise ValueError("Transfer legs must sum to zero.")
...
net = {}
for leg in legs:
    net[leg.wallet.pk] = net.get(leg.wallet.pk, 0) + leg.amount
for wallet_id, change in net.items():
    _check_can_change(locked[wallet_id], change)
```

- خرید پول نمی‌سازد و از بین نمی‌برد، فقط جابه‌جا می‌کند. جمع صفر یعنی اگر کمیسیون غلط حساب شود، همان لحظه خطا می‌گیری، نه ماه بعد در حساب‌رسی.
- **`net`:** یک کیف پول ممکن است چند پایه داشته باشد (فروشنده‌ای با دو کتاب در یک سفارش). بررسی موجودی روی تغییر **خالص** است، نه هر پایه جدا.
- `ValueError` (خطای برنامه‌نویس) با `WalletError` (قاعدهٔ کاربر) فرق دارد: اولی یعنی کد ما غلط است و نباید به کاربر برسد.
- `Leg` یک `NamedTuple` است، یعنی tupleی که فیلدهایش نام دارند و پیش‌فرض می‌گیرند.

**`purchase_legs`:** یک بدهی خریدار برای کل سفارش، و برای هر کتاب سهم فروشنده و کمیسیون مگابوک. پایه‌های صفر حذف می‌شوند، چون قید `ledger_amount_not_zero` ردیف صفر را قبول نمی‌کند. کتاب رایگان هیچ پایه‌ای ندارد و کتاب ادمین پایهٔ فروشنده ندارد.

### ۷.۵ مدل‌های درخواست

- **`ReviewedRequest`** یک **مدل abstract** است (`abstract = True`): جدول ندارد و فقط فیلدها و رفتار مشترک را به `TopUpRequest` و `WithdrawalRequest` می‌دهد. `save()` آن جلوی تغییر وضعیت نهایی را می‌گیرد. `FINAL_STATUSES` را هر زیرکلاس خودش تعریف می‌کند.
- **`Wallet` و قیدهایش:** `wallet_owner_matches_kind` می‌گوید «کیف پول کاربر صاحب دارد و کیف پول مگابوک ندارد». `single_platform_wallet` یک partial unique روی `kind` است (فقط وقتی `kind="platform"` باشد) تا فقط یکی وجود داشته باشد.
- **`Wallet.owner` با `CASCADE` ولی `LedgerEntry.wallet` با `PROTECT`:** کاربری که هنوز هیچ تراکنشی ندارد پاک می‌شود و کیف پولش هم با او. کاربری که یک بار پول جابه‌جا کرده پاک نمی‌شود، چون `PROTECT` روی تراکنش جلوی حذف کیف پول و در نتیجه کاربر را می‌گیرد.

### ۷.۶ `signals.py` و `apps.py`

```python
@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_wallet_for_new_user(sender, instance, created, raw=False, **kwargs):
    if created and not raw:
        services.ensure_user_wallet(instance)
```

- `post_save` بعد از **هر** `save()` روی کاربر فرستاده می‌شود. `created` فقط بار اول `True` است.
- `raw` یعنی داده از fixture بار می‌شود (`loaddata`) و کیف پول هم احتمالاً در همان fixture هست.
- **چرا سیگنال، نه کد در `Account.save()`؟** آن وقت `accounts` (پایین‌ترین اپ) به `wallet` وابسته می‌شد.
- **چرا نه در `create_user`؟** ادمین کاربر را با فرم می‌سازد و `seed_books` با `get_or_create`. هیچ‌کدام از `create_user` رد نمی‌شوند، ولی همه به `save()` می‌رسند.

```python
class WalletConfig(AppConfig):
    def ready(self):
        from . import signals  # noqa: F401
```

گیرندهٔ سیگنال فقط وقتی ثبت می‌شود که ماژولش import شود. `ready()` جای استاندارد این کار است. بدون این خط، `@receiver` هرگز اجرا نمی‌شد و کاربران بی‌کیف‌پول ساخته می‌شدند. `# noqa` به linter می‌گوید «این import عمداً استفاده نشده».

`0002_platform_and_user_wallets.py` یک **data migration** است: با `RunPython` کیف پول مگابوک و کیف پول کاربران موجود را ساخت. migration معمولی فقط ساختار جدول را عوض می‌کند. این یکی داده می‌سازد.

### ۷.۷ Viewها و درگاه

- **`MockTopupView.dispatch`:** `dispatch` اولین متدی است که روی یک view اجرا می‌شود، پیش از احراز هویت و بررسی اجازه. `gateways.active_gateway()` با `DEBUG` خاموش `Http404` می‌دهد، پس پاسخ دقیقاً همان 404 آدرسی است که وجود ندارد. حتی بررسی ورود اجرا نمی‌شود که از روی 401 بشود فهمید این آدرس هست.
  - **جایگزین:** ثبت شرطی آدرس در `urls.py` (`if settings.DEBUG: urlpatterns += ...`). استفاده نشده چون Django در تست‌ها `DEBUG` را خاموش می‌کند و این شرط هنگام import یک بار ارزیابی می‌شد، پس قابل تست نبود.
- **`wallet_error(error)`:** یک `WalletError` را به `ValidationError` DRF با همان شکل خطای فرم (`{field: [پیام]}`) تبدیل می‌کند، تا فرانت یک شکل خطا بشناسد.
- **`TRANSACTION_FILTERS`:** فیلتر تب‌های صفحهٔ کیف پول در سرور انجام می‌شود، چون صفحه فقط یک صفحه از تراکنش‌ها را دارد. فیلتر در فرانت روی ۲۰ ردیف نتیجهٔ غلط می‌داد.

### ۷.۸ ادمین کیف پول

- **`ReadOnlyAdminMixin.get_readonly_fields`** همهٔ فیلدهای مدل را فقط‌خواندنی می‌کند. وضعیت فقط با **action** عوض می‌شود و action هم سرویس را صدا می‌زند.
- **`ask_reason`:** یک action با صفحهٔ میانی. Django action را با POST صدا می‌زند. بار اول دکمهٔ `apply` در POST نیست، پس فرم دلیل نشان داده می‌شود. قالب `reason_form.html` همان idهای انتخاب‌شده (`action_checkbox_name`) و نام action را دوباره می‌فرستد تا Django همان action را با `apply` صدا بزند.
- **`WalletAdmin.get_urls`:** یک آدرس سفارشی (`<id>/adjust/`) برای فرم «اصلاح دستی» اضافه می‌کند. `self.admin_site.admin_view(...)` آن را پشت ورود ادمین می‌گذارد. آدرس سفارشی باید **قبل از** `super().get_urls()` بیاید، چون آدرس‌های پیش‌فرض یک الگوی کلی `<path:object_id>/` دارند که آن را می‌بلعید.
- **`get_queryset` با `annotate(balance=...)`:** موجودی همهٔ کیف پول‌های فهرست با یک `SUM ... GROUP BY`.

---

## ۸. `cart`: سبد خرید

- **بدون مدل `Cart`:** هر کاربر دقیقاً یک سبد دارد، پس «سبد کاربر» یعنی ردیف‌های `CartItem` او. جدول `Cart` فقط یک ردیف اضافه برای هر کاربر و یک JOIN اضافه می‌آورد، بدون هیچ اطلاعات تازه‌ای.
- **`price_seen` را سرور می‌گذارد:** `CartItem.objects.create(user=user, book=book, price_seen=book.price)`. فرانت فقط `book_id` می‌فرستد. اگر قیمت از فرانت می‌آمد، کاربر می‌توانست قیمت خودش را بفرستد. البته پول همیشه با قیمت فعلی کتاب گرفته می‌شود و `price_seen` فقط برای هشدار است.
- **`add` بدون خطا برای «از قبل در سبد است»:** `True` یا `False` برمی‌گرداند و view کد 201 یا 200 می‌دهد. دابل‌کلیک بی‌ضرر است.
- **«کتاب نیست» و «کتاب تأیید نشده» یک جواب دارند** (`NOT_AVAILABLE`)، تا از روی پاسخ نشود فهمید کدام idها در دیتابیس هستند.
- **`get_cart` پاک‌سازی می‌کند:** کتابی که کاربر حالا مالکش است (مثلاً در تب دیگری خریده) از سبد حذف و در `removed` گزارش می‌شود. **این یعنی یک GET چیزی می‌نویسد**، که معمولاً خلاف قاعده است. داشبورد عمداً همین منطق را بدون نوشتن تکرار کرده (بخش ۱۰).
- **`cart_response`** (در `serializers.py`) یک تابع معمولی است که خروجی سرویس را به JSON تبدیل می‌کند. `status` یک فیلد مدل نیست: `get_cart` آن را روی هر شیء می‌گذارد (`item.status = ...`) و `CharField(read_only=True)` همان attribute را می‌خواند.
- **`OptionalBookIdSerializer(BookIdSerializer)`** فقط `book_id` را با `required=False` بازتعریف می‌کند.

---

## ۹. `orders` و `library`: خرید و کتابخانه

### ۹.۱ `ImmutableModel` (`backend/orders/models.py`)

همان الگوی ۷.۲ است، ولی به‌شکل یک مدل abstract که `Order` و `OrderItem` از آن ارث می‌برند. `objects = ImmutableQuerySet.as_manager()` روی مدل abstract تعریف شده و به زیرکلاس‌ها هم می‌رسد.

**`OrderItem.price` و `seller_share`** «عکس لحظهٔ خرید»اند، نه کپی‌ای که باید همگام بماند. اگر ادمین بعداً قیمت کتاب را عوض کند، رسید باید هنوز بگوید چقدر پرداخت شده.

`Order.total` یک property است: `sum(item.price for item in self.items.all())`. اگر `prefetch_related("items")` شده باشد، `self.items.all()` از حافظه خوانده می‌شود و query تازه نمی‌زند. برای همین viewها `prefetch_related("items__book")` دارند.

### ۹.۲ `checkout` (`backend/orders/services.py`)

قدم به قدم در بخش ۱۳.۳ دنبالش کرده‌ام. این‌جا فقط دو نکتهٔ ظریف:

```python
cart_items = list(
    CartItem.objects.select_for_update(of=("self",)).filter(user=user).select_related("book", "book__uploaded_by")
)
```

`select_for_update` با `select_related` به‌طور پیش‌فرض **همهٔ** جدول‌های JOIN‌شده را قفل می‌کند، یعنی ردیف کتاب‌ها هم قفل می‌شد. آن وقت هر خریدار دیگری که همین کتاب را می‌خرد منتظر می‌ماند. `of=("self",)` یعنی فقط ردیف‌های `CartItem` قفل شوند.

```python
except wallet_services.WalletError:
    shortfall = total - wallet_services.balance_of(buyer_wallet)
    raise CheckoutError(INSUFFICIENT_BALANCE, ..., shortfall=shortfall)
```

`transfer` موجودی را **زیر قفل** بررسی کرد و رد کرد. این‌جا موجودی دوباره خوانده می‌شود، ولی فقط برای ساختن پیام «چقدر کم دارید». تصمیم قبلاً زیر قفل گرفته شده. وقتی `CheckoutError` از بلوک `atomic` بیرون برود، **همه‌چیز** برمی‌گردد: سفارش، کتابخانه و هر تراکنش.

### ۹.۳ `CheckoutView`

برای `cart_changed` و `already_owned`، پاسخ خطا **سبد فعلی** را هم دارد. این سبد بعد از rollback ساخته می‌شود (`get_cart` بعد از برگشتن exception صدا زده می‌شود)، پس پاک‌سازی کتاب‌های مالک‌شده ماندگار است. صفحه بدون درخواست دوم نشان می‌دهد چه چیزی عوض شده.

### ۹.۴ `library`

- **`LibraryItem` جدا از `OrderItem`:** «این کاربر این کتاب را دارد؟» یک جدول و یک قید یکتا دارد، هر منبعی که داشته باشد. `order_item` اختیاری است تا اگر روزی کتاب هدیه داده شود، سفارش جعلی لازم نباشد.
- **`LibraryBookSerializer`** روی `LibraryItem` است، ولی `id` را از `book.id` می‌گیرد (`source="book.id"`)، چون فرانت با id کتاب به صفحهٔ خواندن می‌رود.

---

## ۱۰. `dashboard`: شمارش و پیگیری

اپی بدون مدل که فقط می‌خواند. درس اصلی‌اش **شمارش درست در SQL** است.

### ۱۰.۱ `_counts_by`

```python
def _counts_by(queryset, field, keys):
    counts = dict.fromkeys(keys, 0)
    for row in queryset.order_by().values(field).annotate(n=Count("id")):
        counts[row[field]] = row["n"]
    return counts
```

- `.values(field).annotate(n=Count(...))` در Django یعنی `GROUP BY field`. ترتیب مهم است: `values` قبل از `annotate` گروه‌بندی می‌کند.
- **`.order_by()` خالی** ترتیب پیش‌فرض مدل (`Meta.ordering`) را حذف می‌کند. اگر نمی‌کرد، Django ستون ترتیب را هم به `GROUP BY` اضافه می‌کرد و هر ردیف گروه خودش می‌شد. این یکی از دام‌های معروف Django است.
- `dict.fromkeys(keys, 0)`: وضعیتی که هیچ ردیفی ندارد هم با ۰ در پاسخ می‌آید.

### ۱۰.۲ `aggregate` با `filter`

```python
LedgerEntry.objects.filter(wallet__owner=user).aggregate(
    balance=_sum("amount"),
    earnings=_sum("amount", filter=Q(type=LedgerEntry.Type.SALE_INCOME)),
)
```

دو جمع با شرط‌های متفاوت در **یک** query. `filter=` به `SUM(...) FILTER (WHERE ...)` در PostgreSQL تبدیل می‌شود.

### ۱۰.۳ subquery به‌جای JOIN (`backend/dashboard/queries.py`)

```python
sales = (
    OrderItem.objects.filter(book=OuterRef("pk")).order_by().values("book")
    .annotate(n=Count("id")).values("n")[:1]
)
...
queryset.annotate(sales_count=Coalesce(Subquery(sales), Value(0)), ...)
```

**مشکل:** اگر بنویسی `annotate(sales=Count("order_items"), unread=Count("conversation__messages"))`، Django **دو JOIN** روی یک query می‌زند. کتابی با ۳ فروش و ۴ پیام ۳×۴=۱۲ ردیف می‌سازد و هر دو شمارش ۱۲ می‌شوند. این باگ رایج و بی‌صدایی است.

**راه حل:** هر شمارش یک subquery جدا که فقط یک عدد برمی‌گرداند.
- `.values("book").annotate(...)` گروه‌بندی می‌کند.
- `.values("n")[:1]` فقط ستون عدد و حداکثر یک ردیف را برمی‌دارد.
- `Coalesce(..., 0)` برای کتابی که هیچ فروشی ندارد (subquery هیچ ردیفی ندارد و NULL می‌دهد).

**`my_request_entries` و `my_uploads`** پایهٔ مشترک شمارنده‌های داشبورد و فهرست‌های «درخواست‌ها و آپلودهای من» هستند. یک عدد روی کارت داشبورد و طول فهرست هرگز نمی‌توانند با هم فرق داشته باشند.

**`cart_numbers`** منطق `get_cart` را **بدون حذف** تکرار می‌کند: `.exclude(book__uploaded_by=user).filter(~Exists(in_library))`. یک GET برای داشبورد نباید چیزی بنویسد.

---

## ۱۱. `support`: گفت‌وگو با پشتیبانی

### ۱۱.۱ مدل

- **دو `OneToOneField` با قید «دقیقاً یکی»** (`conversation_has_exactly_one_parent`): گفت‌وگو یا مال یک `RequestEntry` است یا مال یک `Book`.
  - **جایگزین:** `GenericForeignKey` (یک FK که به هر مدلی اشاره کند). استفاده نشده چون قید دیتابیس و `CASCADE` واقعی ندارد.
  - `OneToOne` یعنی دو «پیام اول» هم‌زمان نمی‌توانند دو گفت‌وگو بسازند.
- **گفت‌وگو به `RequestEntry` وصل است، نه `BookRequest`.** ده نفری که یک کتاب را خواسته‌اند پیام‌های همدیگر را نمی‌بینند.
- **قید `conversation_closed_fields_match`:** سه حالت مجاز را فهرست می‌کند: باز (همه خالی)، بسته به‌خاطر تأمین (بدون `closed_by`)، و بسته به‌دست پشتیبانی (با `closed_by`).

### ۱۱.۲ فرستنده را سرور تعیین می‌کند

`NewMessageSerializer` فقط `text` دارد. اگر کلاینت `sender: "support"` بفرستد، این فیلد اصلاً در serializer نیست و نادیده گرفته می‌شود. `post_user_message` فقط پیام `user` می‌سازد و یک بار دیگر هم بررسی می‌کند که کاربر صاحب والد است، حتی اگر view قبلاً بررسی کرده باشد: «دفاع در عمق».

### ۱۱.۳ `_locked_for` و بستن هم‌زمان

```python
with transaction.atomic():
    conversation = _locked_for(parent)        # get_or_create + select_for_update
    if conversation.is_closed:
        raise SupportError(CONVERSATION_CLOSED)
    message = Message.objects.create(...)
```

بدون قفل، کاربر «بسته نیست» را می‌خواند، هم‌زمان ادمین می‌بست، و پیام کاربر **بعد از** بسته شدن ثبت می‌شد.

### ۱۱.۴ خوانده‌نشده با دو زمان

به‌جای یک پرچم «خوانده شد» روی هر پیام، گفت‌وگو دو زمان دارد: `user_last_read_at` و `support_last_read_at`. خوانده‌نشده برای کاربر یعنی «پیام‌های پشتیبانی یا سیستم بعد از `user_last_read_at`». یک UPDATE برای «همه را خواندم» کافی است. `Count(..., filter=...)` در `user_unread_count` و `support_unread_count` همین را در SQL حساب می‌کند.

### ۱۱.۵ URLها با `as_view(**kwargs)`

```python
def views_for(prefix, find_parent, describe):
    kwargs = {"find_parent": find_parent}
    return [
        path(f"{prefix}/<int:pk>/", ConversationView.as_view(**kwargs, describe=describe), ...),
        ...
    ]
```

`as_view(x=...)` روی هر نمونهٔ view، `self.x = ...` می‌گذارد. یک کلاس view برای دو نوع والد کار می‌کند و فقط «چطور والد **من** را پیدا کنم» و «چطور توصیفش کنم» عوض می‌شود.

**نکته:** `as_view` فقط نام‌هایی را قبول می‌کند که از قبل روی کلاس باشند. برای همین کلاس‌ها `find_parent = None` و `describe = None` دارند. بدون آن خط‌ها، `TypeError` می‌گرفتی.

**مالکیت داخل query:** `get_object_or_404(RequestEntry..., pk=pk, requester=request.user)`. id مال کس دیگر «پیدا نمی‌شود» و جواب همان 404 است. هیچ کد جدایی برای «اجازه داری؟» لازم نیست و هیچ 403ی هم وجود ندارد که لو بدهد آن id وجود دارد.

### ۱۱.۶ throttle

`throttle_classes = [ScopedRateThrottle]` و `throttle_scope = "support_messages"` با `DEFAULT_THROTTLE_RATES` در settings یعنی ۱۰ پیام در دقیقه برای هر کاربر، با پاسخ 429. شمارش در cache پیش‌فرض (حافظهٔ پروسه) است.

### ۱۱.۷ ادمین گفت‌وگو

`ConversationForm` فیلدهای اضافه‌ای دارد که ستون مدل نیستند (`reply`، `close`، `reopen`). `ConversationAdmin.save_model` به‌جای ذخیرهٔ معمولی، آن‌ها را به سرویس‌ها می‌دهد. `get_fields` برای فرم «افزودن» و «ویرایش» فیلدهای متفاوت برمی‌گرداند. `change_view` با GET، «پشتیبانی خواند» را ثبت می‌کند.

---

## ۱۲. فرانت

### ۱۲.۱ لایهٔ API (`frontend/src/api/`)

برای هر اپ بک‌اند یک فایل هست و کامپوننت‌ها هرگز مستقیم axios صدا نمی‌زنند. همه از `apiClient` در `client.js` استفاده می‌کنند.

**`client.js`: دو interceptor**

interceptor تابعی است که axios قبل از هر درخواست یا بعد از هر پاسخ اجرا می‌کند.

```js
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token && !config._skipAuth) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

هدر JWT خودکار به هر درخواست اضافه می‌شود. `_skipAuth` یک پرچم سفارشی ماست، نه بخشی از axios.

```js
let refreshPromise = null;
function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (refresh ? axios.post(`${BASE_URL}/accounts/token/refresh/`, { refresh }) ... )
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
```

**«single-flight»:** اگر صفحه پنج درخواست هم‌زمان بفرستد و access منقضی باشد، هر پنج 401 می‌گیرند. بدون این ترفند، پنج refresh هم‌زمان فرستاده می‌شد. حالا اولی یک Promise می‌سازد و بقیه منتظر **همان** می‌مانند. برای refresh از `axios` خام استفاده می‌شود، نه `apiClient`، تا از interceptorهای خودمان رد نشود و حلقهٔ بی‌نهایت ساخته نشود.

```js
if (error.response?.status !== 401 || !original || original._retry || isAuthUrl) {
  return Promise.reject(error);
}
original._retry = true;
```

- **`_retry`:** اگر درخواست تکرارشده هم 401 بگیرد، دوباره refresh نکن (جلوی حلقه).
- **`AUTH_URLS`:** 401 روی `/login/` یعنی «رمز اشتباه»، نه «توکن منقضی».

اگر refresh هم شکست بخورد، توکن‌ها پاک می‌شوند و درخواست یک بار **بدون** توکن تکرار می‌شود. صفحه‌های عمومی (فهرست کتاب‌ها) هنوز کار می‌کنند و صفحه‌های خصوصی 401 را به کامپوننت می‌دهند.

**`auth.js`:**
- `saveTokens` توکن‌ها را در `localStorage` می‌گذارد و `notifyAuthChanged()` را صدا می‌زند.
- `isLoggedIn()` **بدون درخواست به سرور** بخش وسط JWT (payload) را با `atob` decode می‌کند و `exp` را می‌خواند. JWT رمزگذاری نشده، فقط امضا شده، پس هر کسی محتوایش را می‌خواند. این فقط برای تصمیم نمایش صفحه است و اعتبار واقعی را همیشه بک‌اند بررسی می‌کند. `.replace(/-/g, '+')...` چون JWT از base64**url** استفاده می‌کند و `atob` base64 معمولی می‌خواهد.
- `logoutUser` اول توکن‌ها را محلی پاک می‌کند و بعد refresh را در بک‌اند باطل می‌کند. `.catch(() => {})` یعنی اگر باطل کردن شکست خورد (مثلاً توکن قبلاً منقضی شده)، خروج باز هم انجام شده حساب شود.

**`authEvents.js`:** یک رویداد سفارشی مرورگر (`window.dispatchEvent(new Event(...))`). چرا فایل جدا؟ `auth.js` و `client.js` هر دو باید این رویداد را بفرستند و `auth.js` خودش `client.js` را import می‌کند. اگر تابع در `auth.js` بود، import دوطرفه پیش می‌آمد.

### ۱۲.۲ `CartProvider` و `useCart`

**Context** راهی است تا یک داده بدون پاس دادن از propها به همهٔ کامپوننت‌های زیرین برسد. `main.jsx` کل اپ را داخل `<CartProvider>` می‌گذارد. هر کامپوننتی با `useCart()` همان سبد را می‌خواند: نشان تعداد در navbar، دکمهٔ صفحهٔ کتاب، صفحهٔ سبد. این‌ها هرگز با هم ناهماهنگ نمی‌شوند.

سه ترفند در `frontend/src/context/CartProvider.jsx` هست:

**۱. `pendingRef` کنار `pending`:**

```js
const [pending, setPending] = useState(() => new Set());
const pendingRef = useRef(new Set());
```

`setState` در React **فوری** اعمال نمی‌شود. اگر کاربر دو بار سریع کلیک کند، کلیک دوم هنوز state قدیمی («در حال اجرا نیست») را می‌بیند. `useRef` یک جعبهٔ قابل تغییر است که مقدارش همان لحظه عوض می‌شود. ref جواب «الان در حال اجراست؟» را فوری می‌دهد و state باعث رندر دوباره (غیرفعال شدن دکمه) می‌شود.

**۲. شمارندهٔ `generation`:**

```js
const gen = generation.current;
const data = await getCart();
if (gen !== generation.current) return null;
```

اگر کاربر A خارج شود و B وارد شود در حالی که درخواست سبد A هنوز در راه است، پاسخ دیر رسیدهٔ A نباید سبد B را بپوشاند. با هر تغییر کاربر، `generation` یکی زیاد می‌شود و پاسخ‌های نسل قبلی دور ریخته می‌شوند.

**۳. `useMemo` برای `value`:** بدون آن، هر رندر Provider یک شیء تازه می‌ساخت و **همهٔ** مصرف‌کننده‌های Context دوباره رندر می‌شدند، حتی اگر چیزی عوض نشده بود.

`useCart` اگر خارج از Provider صدا زده شود، خطای واضح می‌دهد، به‌جای اینکه بی‌صدا `null` برگرداند.

**چرا سبد در سرور و نه در `localStorage`؟** قیمت و وضعیت باید از سرور بیاید و سبد باید روی هر دستگاهی یکی باشد. Provider هیچ جمعی را خودش حساب نمی‌کند و هر پاسخ کل سبد را برمی‌گرداند.

### ۱۲.۳ الگوی بار کردن صفحه (`frontend/src/components/HomePage.jsx`)

```js
const [booksStatus, setBooksStatus] = useState("loading");   // loading | error | success
const [booksAttempt, setBooksAttempt] = useState(0);

useEffect(() => {
  const controller = new AbortController();
  getBooks({ category: activeCategory, signal: controller.signal })
    .then((data) => { setBooks(...); setBooksStatus("success"); })
    .catch(() => { if (!controller.signal.aborted) setBooksStatus("error"); });
  return () => controller.abort();
}, [activeCategory, booksAttempt]);
```

- **یک متغیر وضعیت** (`loading | error | success`) به‌جای چند boolean. حالت‌های ناممکن («هم در حال بار شدن و هم خطا») ساخته نمی‌شوند.
- **`useEffect` با وابستگی‌ها:** هر بار `activeCategory` یا `booksAttempt` عوض شود، دوباره اجرا می‌شود. «تلاش دوباره» فقط `booksAttempt` را یکی زیاد می‌کند تا effect دوباره اجرا شود.
- **تابع cleanup و `AbortController`:** تابعی که effect برمی‌گرداند، قبل از اجرای بعدی (یا وقتی صفحه بسته می‌شود) اجرا می‌شود. اگر کاربر سریع بین تب‌ها جابه‌جا شود، پاسخ تب قبلی که دیرتر رسیده نباید فهرست تب فعلی را بپوشاند. `abort()` درخواست قبلی را لغو می‌کند و `if (!controller.signal.aborted)` لغو را خطا حساب نمی‌کند.

`BookReaderPage` همین را با یک پرچم `cancelled` ساده انجام می‌دهد و به‌جای وضعیت جدا، `key` را در نتیجه نگه می‌دارد. اگر `result.key` با `id` فعلی نخواند، یعنی پاسخ مال کتاب قبلی است و هنوز در حال بار شدن هستیم.

**ترفند پنجرهٔ تازه** در `BookReaderPage.openInNewTab`:

```js
const tab = window.open("", "_blank");   // synchronously, inside the click
const link = await getBookFileLink(id);
tab.location.href = link.url;
```

مرورگرها پنجره‌ای را که **بعد از** یک `await` باز شود pop-up حساب می‌کنند و مسدودش می‌کنند. پنجره همان لحظهٔ کلیک باز می‌شود و بعد پر می‌شود.

### ۱۲.۴ routing و صفحه‌های محافظت‌شده (`frontend/src/App.jsx`)

- `<Routes>` و `<Route path element>` از React Router. `/books/new` و `/books/:id` با هم قاطی نمی‌شوند چون React Router مسیر ثابت را بر مسیر پارامتری مقدم می‌داند.
- **`ProtectedRoute`** اگر وارد نشده باشی، با `<Navigate to="/login" state={{ from: location }}>` به صفحهٔ ورود می‌فرستد. صفحهٔ ورود `location.state?.from` را می‌خواند و بعد از ورود برمی‌گرداند. این فقط تجربهٔ کاربری است: امنیت واقعی در بک‌اند است.
- **`useGoBack`:** `navigate(-1)` اگر کاربر مستقیم با آدرس آمده باشد او را از سایت بیرون می‌برد. `window.history.state?.idx` را `BrowserRouter` خودش نگه می‌دارد. `idx === 0` یعنی صفحهٔ قبلی در سایت نیست، پس به صفحهٔ اصلی می‌رود.
- کامپوننت‌های کوچک `AddBookPage`، `WalletRoute` و... در `App.jsx` فقط `onBack={goBack}` را به صفحه پاس می‌دهند. صفحه‌ها خودشان به React Router وابسته نمی‌شوند.

---

## ۱۳. چهار مسیر کامل، از کلیک تا دیتابیس

### ۱۳.۱ ورود

1. **`Login.jsx`:** کاربر «۰۹۱۲ ۳۴۵ ۶۷۸۹» و رمز را وارد می‌کند و `loginUser({identifier, password})` صدا زده می‌شود.
2. **`api/auth.js`:** `apiClient.post('/accounts/login/', {...})`. interceptor درخواست اگر توکن قدیمی باشد هدر می‌گذارد، ولی برای این view مهم نیست.
3. **`MegaBook_Backend/urls.py`:** `path('accounts/', include('accounts.urls'))` و بعد در `accounts/urls.py`: `path('login/', LoginView.as_view())`.
4. **`LoginView`** (`TokenObtainPairView` با `serializer_class = LoginSerializer`) با `authentication_classes = ()` هدر را نادیده می‌گیرد.
5. **`LoginSerializer.validate` ← `super().validate`:** simplejwt `authenticate(request, identifier="۰۹۱۲ ۳۴۵ ۶۷۸۹", password=...)` را صدا می‌زند.
6. **`IdentifierBackend.find_user`:** `@` ندارد، پس موبایل است. `normalize_phone` رقم فارسی را لاتین می‌کند و فاصله را حذف می‌کند و نتیجه `"09123456789"` است. بعد `SELECT ... FROM accounts_account WHERE phone = '09123456789'`.
7. **`check_password_with_timing_attack_mitigation`** رمز را با hash ذخیره‌شده مقایسه می‌کند. `user_can_authenticate` بررسی می‌کند `is_active` باشد.
8. **simplejwt** `RefreshToken.for_user(user)` را می‌سازد. اپ blacklist یک ردیف `OutstandingToken` ثبت می‌کند. `UPDATE_LAST_LOGIN` ستون `last_login` را به‌روز می‌کند. access از روی refresh ساخته می‌شود.
9. **`LoginSerializer.validate`** `data['user']` را اضافه می‌کند و پاسخ 200 `{refresh, access, user}` است. اگر شکست بخورد، 401 با پیام `LOGIN_FAILED` می‌آید.
10. **`saveTokens`** توکن‌ها را در `localStorage` می‌گذارد و `notifyAuthChanged()` را صدا می‌زند. `CartProvider` رویداد را می‌شنود، `generation` را زیاد می‌کند و `GET /cart/` را با هدر `Bearer` می‌فرستد.
11. **`Login.jsx`** به `from` (صفحه‌ای که کاربر از آن آمده بود) یا صفحهٔ اصلی برمی‌گردد.

### ۱۳.۲ درخواست کتاب با شابک

1. **`RequestByIsbnPage.jsx`:** کاربر شابک را وارد می‌کند و `lookupIsbn(isbn)` یعنی `GET /catalog/isbn-lookup/?isbn=...` فرستاده می‌شود.
2. **`IsbnLookupView`** (فقط کاربر واردشده):
   - `normalize_isbn` (ISBN-10 به ۱۳ رقمی، بررسی رقم کنترلی؛ اگر نامعتبر، 400)
   - `Book.active_for_isbn` برای وضعیت در مگابوک
   - `lookup_isbn` ← `openlibrary.fetch` ← `requests.get(..., timeout=5)`
   - پاسخ 200 با مشخصات، یا 404 یا 502، همه با `already_exists` و `existing_status`
3. **صفحه** اگر `existing_status` `approved` باشد، به صفحهٔ کتاب راهنمایی می‌کند. وگرنه فرم را با عنوان و نویسنده پر می‌کند (یا دستی).
4. **ثبت:** `createBookRequest({isbn, title, authors, cover_url, notes})` یعنی `POST /book-requests/` (JSON).
5. **`BookRequestListCreateView.post`:** `BookRequestCreateSerializer` فقط ورودی را اعتبارسنجی می‌کند (`validate_isbn` باز هم `normalize_isbn`). `requester` فیلد نیست، پس کلاینت نمی‌تواند به نام کس دیگری درخواست بدهد.
6. **`services.submit_request(request.user, ...)`** داخل `atomic`:
   1. `Book.active_for_isbn` دوباره، چون ممکن است در این فاصله کسی کتاب را بارگذاری کرده باشد.
   2. `BookRequest.objects.select_for_update().get_or_create(isbn=...)`، که اگر تازه باشد INSERT و قفل است.
   3. «رد شده؟» و «همین کاربر قبلاً؟»
   4. `RequestEntry.objects.create(...)` داخل savepoint. قید `unique_request_entry_per_user` آخرین نگهبان است.
7. **پاسخ** 201 `{result: "requested", message, isbn}` یا 409 با `result` دیگر. صفحه روی `result` شاخه می‌زند.

بعداً وقتی ادمین کتابی با همین شابک تأیید کند: `Book.save` ← `sync_with_book` ← `BookRequest.save` (وضعیت «تأمین شده») ← `on_request_status_changed` ← یک پیام سیستمی برای هر `RequestEntry` و بسته شدن خودکار گفت‌وگو.

### ۱۳.۳ خرید از سبد

1. **`CartPage.jsx`:** دکمهٔ پرداخت فقط وقتی فعال است که همهٔ آیتم‌ها `ok` باشند و موجودی کافی باشد (هر دو از پاسخ سرور). با کلیک، `checkout()` از `useCart` صدا زده می‌شود.
2. **`CartProvider.checkout`:** اگر کلید `"checkout"` در `pendingRef` باشد، کاری نمی‌کند (جلوی دابل‌کلیک). بعد `POST /orders/checkout/` بدون بدنه.
3. **`CheckoutView.post`** ← `services.checkout(request.user)`. همهٔ قدم‌های زیر در **یک** تراکنش:
   1. `SELECT ... FROM accounts_account WHERE id = ? FOR UPDATE`: قفل کاربر. checkout دوم هم‌زمان (دابل‌کلیک که از فرانت رد شده) این‌جا صبر می‌کند و بعد سبد خالی می‌بیند.
   2. `CartItem ... FOR UPDATE OF cart_cartitem`: قفل فقط ردیف‌های سبد، نه کتاب‌ها.
   3. `status_of` برای هر آیتم. اگر قیمت عوض شده یا کتاب برداشته شده، `cart_changed`.
   4. `owned_book_ids` دوباره (شاید در تب دیگری خریده).
   5. `Order.objects.create` و یک `OrderItem` برای هر کتاب، با `price` و `seller_share` **همین لحظه**. قید `order_item_price_covers_share` در دیتابیس.
   6. `LibraryItem` برای هر کتاب داخل savepoint. قید `library_one_copy_per_user` آخرین نگهبان در برابر دو بار خریدن است.
   7. اگر جمع صفر نباشد:
      - `purchase_legs`: بدهی خریدار، سهم هر فروشنده، کمیسیون مگابوک.
      - `transfer`: جمع صفر؟ ← قفل کیف پول‌ها **به ترتیب id** ← `_check_can_change` روی تغییر خالص (`SUM` در دیتابیس) ← `INSERT` ردیف‌های `LedgerEntry` با یک `group` مشترک.
      - قیدهای علامت، `group` و پیوند به سفارش هم در دیتابیس بررسی می‌شوند.
   8. `cart_services.clear(user)`.
   
   COMMIT: همه‌چیز با هم ثبت می‌شود. اگر هر جا exception بیاید: ROLLBACK و هیچ چیزی ثبت نمی‌شود.
4. **پاسخ:**
   - 201 با `OrderSerializer` (بدون `seller_share`).
   - یا 409 `{code: "insufficient_balance", shortfall}`.
   - یا 409 `{code: "cart_changed", cart}`.
5. **`CartProvider`:** در موفقیت `refresh()` (سبد حالا خالی است). در خطا اگر `cart` آمده باشد، state را با آن جایگزین می‌کند تا آیتم‌های مشکل‌دار علامت بخورند.
6. **`CartPage`** در موفقیت `navigate("/library", ...)` می‌کند و کتاب‌ها آن‌جا هستند.

### ۱۳.۴ شارژ کارت‌به‌کارت تا موجودی

1. **`WalletPage.jsx`:** `GET /wallet/` موجودی و `topup_card` را از `settings.MEGABOOK_CARD_*` می‌دهد. کاربر بیرون از سایت واریز می‌کند و فرم را پر می‌کند. صفحه یک `FormData` می‌سازد (چون فایل رسید دارد) و `createTopupRequest(data)` یعنی `POST /wallet/topup-requests/` (multipart).
2. **`TopUpRequestListCreateView`:** `parser_classes` شامل `MultiPartParser` است.
3. **`TopUpRequestSerializer`:**
   - `amount_field()`: عدد صحیح، دست‌کم ۱.
   - `validate_tracking_number`: `normalize_tracking_number` و بعد «تکراری بین غیر ردشده‌ها؟».
   - `validate_deposited_at`: آینده نباشد.
   - `validate_receipt`: JPG یا PNG، کمتر از ۵ MB.
   - `create`: `TopUpRequest.objects.create(user=self.context["request"].user, ...)` داخل `atomic`، با ترجمهٔ `IntegrityError` قید `topup_tracking_unique_unless_rejected`.
   
   فایل رسید با `RandomName` در `private_media/wallet/receipts/` ذخیره می‌شود. **هنوز هیچ ردیفی در دفتر ثبت نشده:** درخواست پول نیست.
4. **پنل ادمین:** ادمین ردیف را تیک می‌زند و action «تایید و شارژ کیف پول» را اجرا می‌کند ← `run_service` ← `services.approve_topup(r, request.user)`:
   - `_require_admin`
   - `atomic`
   - `_locked_request`: قفل ردیف درخواست و بررسی «هنوز pending است؟»
   - `_lock` کیف پول
   - `status=approved`، `reviewed_by`، `reviewed_at`، و `save()`. `ReviewedRequest.save` جلوی تغییر وضعیت نهایی را می‌گیرد. قید `topup_reviewed_at_matches_status` هم برقرار است.
   - `LedgerEntry.objects.create(amount=+..., type="topup", topup_request=request)`. قیدهای علامت، «یک منبع» و یکتایی `topup_request` بررسی می‌شوند.
   - COMMIT
5. **کاربر** دوباره `GET /wallet/` می‌گیرد. `balance_of` یعنی `SELECT COALESCE(SUM(amount), 0) ...`، که حالا مبلغ شارژ را هم شامل است. تراکنش در `GET /wallet/transactions/?type=topup` با `source: "card_to_card"` دیده می‌شود.

---

## ۱۴. واژه‌نامه

### Django

| مفهوم | توضیح | کجا در پروژه |
|---|---|---|
| **app** | یک بستهٔ پایتون با مدل، view و URLهای یک حوزه. باید در `INSTALLED_APPS` باشد. | هر پوشهٔ زیر `backend/`، مثل `wallet/` |
| **model / migration** | مدل کلاس پایتونی برای یک جدول است. migration فایلی است که تغییر ساختار جدول را ثبت می‌کند (`makemigrations` می‌سازد، `migrate` اجرا می‌کند). | `*/models.py`، `*/migrations/` |
| **data migration** | migrationی که با `RunPython` داده می‌سازد یا تغییر می‌دهد، نه ساختار. | `wallet/migrations/0002_platform_and_user_wallets.py` |
| **manager / QuerySet** | `Model.objects` یک manager است. QuerySet یک query تنبل است که تا وقتی نتیجه را نخواهی اجرا نمی‌شود. هر دو را می‌شود سفارشی کرد. | `AccountManager`، `LedgerEntryQuerySet`، `ImmutableQuerySet` |
| **`Q` / `F`** | `Q` شرطی است که با `&`، `\|` و `~` ترکیب می‌شود. `F` ارجاع به ستونی از همان ردیف است. | قیدها در Meta، `owned_q` |
| **`annotate` / `aggregate`** | `annotate` به هر ردیف یک ستون محاسبه‌شده اضافه می‌کند. `aggregate` کل نتیجه را به چند عدد خلاصه می‌کند. | `annotate_is_owned`، `balance_of`، `dashboard/` |
| **`Exists` / `Subquery` / `OuterRef`** | subqueryهایی که به ردیف query بیرونی اشاره می‌کنند (`OuterRef`). بدون JOIN و بدون ردیف تکراری. | `catalog/ownership.py`، `dashboard/queries.py` |
| **`Coalesce`** | اولین مقدار غیر NULL. برای `SUM` روی صفر ردیف. | `balance_of`، `_sum` |
| **`select_related` / `prefetch_related`** | پیش‌واکشی رابطه‌ها. اولی با JOIN (برای FK)، دومی با یک query اضافه (برای چندبه‌چند). جلوی N+1 را می‌گیرند. | `catalog/views.py`، `cart/services.py` |
| **مشکل N+1** | یک query برای فهرست، و بعد یک query برای **هر** ردیف (مثلاً نویسنده‌های هر کتاب). ۲۰ کتاب یعنی ۲۱ query. | پرهیز در همهٔ viewهای فهرست |
| **`transaction.atomic`** | همه یا هیچ. تودرتو یعنی savepoint. | همهٔ `services.py`ها |
| **`select_for_update`** | `SELECT ... FOR UPDATE`: قفل ردیف تا پایان تراکنش. | `wallet/services.py`، `orders/services.py` |
| **`IntegrityError`** | خطایی که دیتابیس برای نقض قید می‌دهد. | هر `except IntegrityError` |
| **`CheckConstraint` / `UniqueConstraint`** | قیدهایی که Django در migration به SQL تبدیل می‌کند. با `condition` شرطی می‌شوند. | `Meta.constraints` در اکثر مدل‌ها |
| **`on_delete`** | وقتی ردیف مقصد FK پاک شود چه شود. `CASCADE` (این هم پاک شود)، `PROTECT` (جلوی حذف را بگیر)، `SET_NULL`. | `Order.buyer`، `LedgerEntry.wallet`، ... |
| **`clean()` / `full_clean()`** | اعتبارسنجی مدل. فقط فرم‌ها خودکار صدایش می‌زنند. | الگوی ۳.۱ |
| **signal** | «وقتی X شد، این تابع را صدا بزن». مثلاً `post_save` بعد از هر `save()`. | `wallet/signals.py` |
| **`AppConfig.ready()`** | کدی که یک بار بعد از بار شدن اپ‌ها اجرا می‌شود. جای ثبت signal. | `wallet/apps.py` |
| **management command** | دستوری که با `python manage.py <name>` اجرا می‌شود. کلاس `Command` با `handle()`. | `seed_books`، `fulfil_requests_on_sale` |
| **storage** | جایی که `FileField` فایل را ذخیره می‌کند و آدرسش را می‌سازد. | `PrivateStorage` |
| **`@deconstructible`** | به migration یاد می‌دهد یک شیء سفارشی را چطور در فایل بنویسد. | `RandomName` |
| **signing** | امضای داده با `SECRET_KEY` تا قابل جعل نباشد. `TimestampSigner` زمان هم دارد. | `private_files.py` |
| **ModelAdmin** | تنظیم صفحهٔ یک مدل در پنل ادمین. action، inline، `get_urls`، `get_queryset`. | `*/admin.py` |
| **middleware** | لایه‌هایی که هر درخواست و پاسخ از آن‌ها رد می‌شود. | `MIDDLEWARE` در settings |
| **`AUTH_USER_MODEL`** | مدل کاربر پروژه. با `settings.AUTH_USER_MODEL` به آن ارجاع می‌دهیم. | `accounts.Account` |

### DRF

| مفهوم | توضیح | کجا |
|---|---|---|
| **serializer** | تبدیل JSON به داده و برعکس، همراه اعتبارسنجی. `ModelSerializer` فیلدها را از مدل می‌سازد. | `*/serializers.py` |
| **ترتیب اعتبارسنجی** | `to_internal_value` (شامل `validate_<field>` هر فیلد) ← `validate(attrs)` (فقط اگر قبلی بی‌خطا بود) ← `create`/`update` با `save()`. | `BookCreateSerializer` |
| **`read_only` / `write_only`** | فیلدی که فقط در پاسخ می‌آید / فقط در ورودی پذیرفته می‌شود. | `book_file` (write_only)، `price` برای کاربر عادی |
| **`SerializerMethodField`** | فیلدی که مقدارش از `get_<name>()` می‌آید. | `get_file_size`، `get_is_free` |
| **`SlugRelatedField`** | رابطه را با یک فیلد شیء مرتبط (مثلاً `name`) نشان می‌دهد، نه id. | `authors` در serializerهای کتاب |
| **`source=`** | فیلد serializer مقدارش را از attribute دیگری بخواند. | `source="book.id"`، `source="get_status_display"` |
| **APIView / generic views** | `APIView` متدهای `get`/`post` دستی دارد. `ListAPIView`، `ListCreateAPIView` و... الگوهای آماده دارند. | `*/views.py` |
| **`perform_create`** | قلاب ذخیره در generic view. جای مناسب برای `save(user=...)`. | `BookListCreateView` |
| **permission classes** | چه کسی اجازه دارد: `AllowAny`، `IsAuthenticated`، `IsAuthenticatedOrReadOnly`. پروژه کلاس اجازهٔ سفارشی ندارد و به‌جایش مالکیت را در query می‌گذارد. | همهٔ viewها |
| **authentication classes** | چطور کاربر شناخته شود (این‌جا JWT از هدر). اگر خالی باشد، هدر نادیده گرفته می‌شود. | `RegisterView`، `CategoryListView` |
| **pagination** | تقسیم فهرست به صفحه. پاسخ `{count, next, previous, results}`. | `BookPagination`، `WalletPagination`، ... |
| **throttling** | محدودیت تعداد درخواست. | `SendMessageView` |
| **`SearchFilter`** | `?search=` روی `search_fields` با `icontains`. | `BookListCreateView` |
| **parsers** | فرمت بدنهٔ درخواست: JSON، multipart (فایل)، form. | `MultiPartParser` در بارگذاری و شارژ |

### simplejwt

| مفهوم | توضیح | کجا |
|---|---|---|
| **access / refresh token** | access کوتاه‌عمر است و همراه هر درخواست. refresh بلندعمر است و فقط برای گرفتن access تازه. | `SIMPLE_JWT`، `client.js` |
| **blacklist** | جدولی برای باطل کردن refreshها. JWT بدون آن قابل باطل کردن نیست. | logout، تغییر رمز |

### React

| مفهوم | توضیح | کجا |
|---|---|---|
| **component / props** | تابعی که UI برمی‌گرداند. props ورودی‌های آن‌اند. | `components/*.jsx` |
| **`useState`** | مقداری که تغییرش باعث رندر دوباره می‌شود. به‌روزرسانی ناهم‌زمان است. | همه‌جا |
| **`useEffect`** | کدی که بعد از رندر و با تغییر وابستگی‌ها اجرا می‌شود. تابع برگشتی‌اش cleanup است. | بار کردن داده در صفحه‌ها |
| **`useRef`** | جعبه‌ای که مقدارش بین رندرها می‌ماند و تغییرش رندر نمی‌کند. فوری است. | `pendingRef`، `generation` |
| **`useMemo` / `useCallback`** | نگه داشتن یک مقدار یا تابع بین رندرها تا وابستگی‌هایش عوض نشده. | `CartProvider` |
| **Context** | رساندن داده به همهٔ کامپوننت‌های زیرین بدون پاس دادن props. | `CartContext` |
| **custom hook** | تابعی با نام `use...` که hookهای دیگر را ترکیب می‌کند. | `useCart`، `useGoBack` |
| **React Router** | `Routes`/`Route`، `Link`، `useNavigate`، `useParams` (پارامترهای آدرس)، `useSearchParams` (`?tab=`)، `Navigate`. | `App.jsx`، صفحه‌ها |
| **StrictMode** | در توسعه effectها را عمداً دو بار اجرا می‌کند تا cleanupهای ناقص پیدا شوند. | `main.jsx` |
| **axios interceptor** | تابعی که روی همهٔ درخواست‌ها یا پاسخ‌ها اجرا می‌شود. | `client.js` |
| **`AbortController`** | لغو یک درخواست در حال اجرا. | `HomePage`، `BookDetailPage` |
| **Vite / HMR** | ابزار build و سرور توسعه. HMR تغییر کد را بدون reload کامل صفحه اعمال می‌کند. | `vite.config.js` |

### Docker

| مفهوم | توضیح | کجا |
|---|---|---|
| **image / container** | ایمیج قالب فقط‌خواندنی است (از Dockerfile). کانتینر یک اجرای زندهٔ آن است. | `Dockerfile`ها |
| **layer cache** | هر خط Dockerfile یک لایه است و اگر ورودی‌اش عوض نشده باشد از cache استفاده می‌شود. | ترتیب `COPY` در Dockerfileها |
| **volume** | پوشه‌ای بیرون از ایمیج که روی کانتینر سوار می‌شود. نام‌دار (`postgres_data`)، ناشناس (`/app/node_modules`)، یا bind به پوشهٔ میزبان (`./backend/...:/app`). | `docker-compose.yml` |
| **`WORKDIR`** | پوشهٔ کاری داخل کانتینر. باید با مسیر volume بخواند. | `WORKDIR /app` |
| **ports `host:container`** | پورت میزبان را به پورت کانتینر وصل می‌کند. | `8000:8000`، ... |
| **نام سرویس به‌عنوان hostname** | سرویس‌های یک Compose با نامشان همدیگر را پیدا می‌کنند. | `POSTGRES_HOST=db` |
| **`env_file`** | خواندن متغیرهای محیطی از فایل. | `.env` |
| **`exec`** | اجرای یک دستور در کانتینر در حال اجرا. | `docker compose exec backend python manage.py ...` |

---

## ۱۵. چیزهایی که ارزش بررسی دارند

هیچ‌کدام را تغییر ندادم. ترتیب تقریبی از مهم‌تر به کم‌اهمیت‌تر است.

### احتمال باگ یا خطر

1. **`cover_url` درخواست کتاب از کلاینت می‌آید و در صفحهٔ عمومی نمایش داده می‌شود.** `BookRequestCreateSerializer.cover_url` هر `URLField`ی را قبول می‌کند و `PublicRequestsPage.jsx` آن را مستقیم در `<img src>` می‌گذارد. صفحه عمومی است و برای مهمان هم باز است. کاربری می‌تواند هر تصویری از هر سایتی (نامناسب، یا یک «tracking pixel» که IP بازدیدکننده‌ها را ثبت می‌کند) را روی صفحهٔ عمومی مگابوک بگذارد. فرانت در حالت عادی فقط آدرس Open Library را می‌فرستد، ولی API محدودیتی ندارد. ارزش دارد میزبان را مثل `download_cover` محدود کنی.
2. **`BookCreateSerializer.validate_isbn` از `normalize_isbn` استفاده نمی‌کند.** فقط `-` و فاصله را حذف می‌کند و فقط ۱۳ رقم لاتین می‌پذیرد. جستجوی شابک و ثبت درخواست رقم فارسی، خط تیره‌های یونیکدی و ISBN-10 را قبول می‌کنند. فرم فعلی همیشه شکل ۱۳ رقمی جستجو را می‌فرستد و مشکلی پیش نمی‌آید، ولی API ناهماهنگ است.
3. **`QuerySet.update()` روی `Book` و `BookRequest` مسدود نیست**، برخلاف `LedgerEntry`. یک admin action یا اسکریپتی که وضعیت را گروهی عوض کند، `sync_with_book` و پیام‌های سیستمی را بی‌صدا رد می‌کند. قیدهای دیتابیس جلوی دادهٔ غلط را می‌گیرند، ولی جلوی «خبر ندادن» را نه. `fulfil_requests_on_sale` فقط نیمهٔ درخواست‌ها را جبران می‌کند.
4. **`Book.save()` وضعیت قبلی را بیرون از تراکنش و بدون قفل می‌خواند.** اگر دو ادمین هم‌زمان یک کتاب را از دو صفحه ذخیره کنند، ممکن است اثر جانبی دو بار یا هیچ بار اجرا شود. در عمل نادر است.
5. **`client.js` بعد از refresh ناموفق، درخواست اصلی را بدون توکن تکرار می‌کند**، حتی برای POST. برای endpointهای خصوصی فقط 401 دوم می‌گیرد و بی‌ضرر است. ولی اگر روزی یک POST عمومی با اثر جانبی اضافه شود، کاربرِ خارج‌شده بی‌خبر آن را به‌شکل ناشناس انجام می‌دهد.
6. **شمارش throttle در LocMemCache است:** با چند worker، هر worker شمارش خودش را دارد و حد واقعی چند برابر می‌شود.
7. **`sample_file` با نام اصلی فایل کاربر** در `media/books/samples/` ذخیره می‌شود (`upload_to="books/samples/"`، بدون `RandomName`). نام فایل روی کامپیوتر بارگذارنده (که ممکن است اطلاعات شخصی داشته باشد) در آدرس عمومی دیده می‌شود.
8. **`requirements.txt`:** بیشتر پکیج‌ها پین نشده‌اند. یک build در آینده ممکن است با نسخهٔ ناسازگار DRF یا simplejwt بشکند.

### ناهماهنگی و توضیح‌های کهنه

9. **`UploadedBookSerializer`** (`backend/library/serializers.py`) در docstring می‌گوید «در هر وضعیتی (pending و rejected هم)»، ولی `MyUploadsView` فقط کتاب‌های تأییدشده را برمی‌گرداند. فهرست همهٔ وضعیت‌ها حالا در `/dashboard/uploads/` است.
10. **توضیح‌های «later: bought»:** در `BookListSerializer.is_owned` و `toCardProps` در `HomePage.jsx` آمده «اگر آپلود کرده (بعداً: خریده)»، ولی خرید ساخته شده و `is_owned` آن را هم حساب می‌کند.
11. **TODO کهنه در `HomePage.jsx`:** می‌گوید «هنوز مدل سفارش نداریم» و برای همین «پرفروش» ۴ کتاب اول است. مدل سفارش حالا هست و می‌شود پرفروش واقعی را از `OrderItem` حساب کرد.
12. **دو `getMyUploads`** در `frontend/src/api/library.js` و `frontend/src/api/dashboard.js` با نام یکسان و endpoint متفاوت. import اشتباه بی‌صدا دادهٔ دیگری می‌آورد.
13. **`CORS_ALLOWED_ORIGINS` شامل `http://localhost:8000` است**، که خود بک‌اند است. درخواست هم‌origin به CORS نیاز ندارد و این خط بی‌اثر است.
14. **`settings.py`:** `from datetime import timedelta` وسط فایل است، نه بالا. کار می‌کند ولی خلاف عرف است.

### کد مرده یا ناقص

15. **`frontend/src/components/BookCard(me).jsx`** هیچ‌جا import نمی‌شود. یک نسخهٔ قدیمی کارت کتاب با تصویر ثابت است. پرانتز در نام فایل هم با بعضی ابزارها مشکل‌ساز است.
16. **`BottomNavbar.jsx`:** `<a href="#" class="text-xs">`. در JSX باید `className` باشد. React هشدار می‌دهد. لینک «فروشگاه» هم به `#` می‌رود.
17. **لینک‌های `href="#"`** در `Navbar.jsx` و `Footer.jsx` (پرفروش‌ها، تازه‌های نشر، دربارهٔ ما).
18. **`GET /orders/`** ساخته و تست شده، ولی هیچ صفحه‌ای در فرانت از آن استفاده نمی‌کند.
19. **`backend/MegaBook_Backend/venv/`:** یک محیط پایتون روی ویندوز با پکیج‌هایی متفاوت از کانتینر (psycopg 3 به‌جای psycopg2، بدون Pillow و requests). در `.gitignore` هست ولی روی دیسک می‌ماند و اجرای اشتباهی `python manage.py` با آن نتیجهٔ گمراه‌کننده می‌دهد.
20. **`<title>megabook-frontend</title>`** در `frontend/index.html`، عنوان پیش‌فرض Vite است.
