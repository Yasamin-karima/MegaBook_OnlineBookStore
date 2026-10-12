import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBook } from "../api/catalog";
import useGoBack from "../hooks/useGoBack";
import { formatFileSize, formatPrice, languageName, toFaNumber, toFaYear } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// صفحه‌ی یک کتاب: /books/:id (عمومی، ورود لازم نیست)
// داده از GET /catalog/books/<id>/ می‌آید (BookDetailSerializer). نکته‌ها:
//   • authors / translators / tags فهرست «نام»اند (رشته)، نه شیء.
//   • publisher نام ناشر است یا null؛ category به شکل {id, name} است یا null.
//   • cover و sample_file آدرس کامل‌اند یا null.
//   • book_file هرگز در این پاسخ نمی‌آید (محتوای پولی)؛ فقط file_size (بایت).
//   • کتاب ناموجود یا تاییدنشده (pending / rejected) => 404.
// ═════════════════════════════════════════════════════════════

const CART_SOON = "سبد خرید به‌زودی فعال می‌شود";

// «مت هیگ، فلانی»
const joinNames = (names) => names.join("، ");

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════

export default function BookDetailPage() {
  // id از آدرس صفحه می‌آید (مسیر /books/:id در App.jsx). با عوض شدن آدرس، id عوض می‌شود
  // و effect پایین دوباره اجرا می‌شود؛ لازم نیست کامپوننت از نو ساخته شود.
  const { id } = useParams();
  const goBack = useGoBack();

  // با هر «تلاش دوباره» یکی زیاد می‌شود تا effect دوباره اجرا شود
  const [attempt, setAttempt] = useState(0);
  // نتیجه‌ی آخرین درخواست، همراه با کلید همان درخواست: { key, status, book }
  // status: ready | notfound | error. اگر کلید با درخواست فعلی یکی نباشد، یعنی جواب درخواست
  // فعلی هنوز نرسیده و صفحه «در حال بارگذاری» است. این‌طور لازم نیست داخل effect
  // setState("loading") صدا بزنیم.
  const requestKey = `${id}:${attempt}`;
  const [result, setResult] = useState({ key: null, status: "loading", book: null });
  const status = result.key === requestKey ? result.status : "loading";
  const book = result.book;

  // TODO (روز ۱۳، کیف پول): موجودی را جدا از کتاب بگیرید، فقط برای کاربر واردشده
  // (مثلاً اگر توکن هست: GET /wallet/)، و اگر خطا داد نادیده بگیرید (balance همان null بماند).
  // کارت کیف پول پایین فقط وقتی نمایش داده می‌شود که balance مقدار داشته باشد، پس بازدیدکننده‌ی
  // مهمان یا خطای کیف پول هیچ‌وقت صفحه‌ی کتاب را خراب نمی‌کند.
  const [balance] = useState(null);

  // وضعیت‌های تعاملی
  const [descExpanded, setDescExpanded] = useState(false);
  // آدرس جلدی که لود نشد؛ اگر برابر جلد همین کتاب باشد، جای‌خالی نمایش داده می‌شود
  const [failedCover, setFailedCover] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  // فقط خود کتاب تعیین می‌کند صفحه باز شود یا نه. قبلاً کتاب و کیف پول با Promise.all
  // با هم گرفته می‌شدند؛ Promise.all اگر «هر کدام» شکست بخورد کل نتیجه را شکست‌خورده می‌کند،
  // پس خطای کیف پول (مثلاً برای کاربر مهمان) کل صفحه‌ی کتاب را به حالت خطا می‌برد.
  useEffect(() => {
    // AbortController: اگر id عوض شود یا صفحه بسته شود، درخواست قبلی لغو می‌شود
    // تا جواب کتاب قبلی روی صفحه‌ی کتاب جدید ننشیند.
    const controller = new AbortController();
    const key = `${id}:${attempt}`;
    getBook(id, { signal: controller.signal })
      .then((data) => setResult({ key, status: "ready", book: data }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResult({ key, status: err.response?.status === 404 ? "notfound" : "error", book: null });
      });
    return () => controller.abort();
  }, [id, attempt]);

  // در یک SPA مرورگر خودش اسکرول را برنمی‌گرداند؛ بدون این، صفحه‌ای که از وسط صفحه‌ی اصلی
  // باز شده از وسط شروع می‌شد
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  // تایمر پیام کوتاه موقع بسته شدن صفحه پاک شود
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // پیام کوتاه پایین صفحه که بعد از ۲.۵ ثانیه محو می‌شود؛ پیام جدید تایمر قبلی را از نو شروع می‌کند
  function showToast(message) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }

  function handleAddToCart() {
    // TODO (روز ۱۵، سبد خرید): وقتی سبد ساخته شد (مثلاً CartContext):
    //   const { addToCart, isInCart } = useCart();
    //   addToCart(book);
    // و دکمه برای کتابِ داخل سبد «در سبد خرید · مشاهده سبد» (Link به /cart) شود.
    // تا آن موقع دکمه وانمود نمی‌کند کاری انجام شده.
    showToast(CART_SOON);
  }

  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        // منوی اشتراک‌گذاری خود گوشی
        await navigator.share({ title: book.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast("لینک کتاب کپی شد.");
      }
    } catch {
      // کاربر منوی اشتراک را بست؛ کاری لازم نیست
    }
  }

  async function handleCopyIsbn() {
    try {
      await navigator.clipboard.writeText(book.isbn);
      showToast("شابک کپی شد.");
    } catch {
      /* مرورگر اجازه کپی نداد */
    }
  }

  // ── حالت‌های بارگذاری و خطا ──
  if (status === "loading") return <LoadingState />;
  if (status === "notfound")
    return <MessageState emoji="🔍" title="این کتاب پیدا نشد" text="ممکن است حذف شده یا هنوز تایید نشده باشد." />;
  if (status === "error")
    return (
      <MessageState
        emoji="⚠️"
        title="بارگذاری کتاب ناموفق بود"
        text="اتصال اینترنت را بررسی کنید و دوباره تلاش کنید."
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );

  // ── محاسبات نمایشی ──
  const isFree = book.price === 0;
  const shortage = isFree ? 0 : Math.max(0, book.price - (balance ?? 0));
  const isTranslated = book.translators.length > 0;
  const showCover = book.cover && failedCover !== book.cover;

  // TODO (روز ۱۶-۱۷، خرید): is_owned هنوز در API نیست و اینجا همیشه undefined است، پس
  // همیشه شاخه‌ی خرید نمایش داده می‌شود. وقتی خرید ساخته شد، API برای کاربر واردشده
  // is_owned را برمی‌گرداند و شاخه‌ی «خواندن کتاب» فعال می‌شود.
  const isOwned = Boolean(book.is_owned);

  // فقط ویژگی‌هایی که مقدار دارند نمایش داده می‌شوند (خیلی از فیلدها اختیاری‌اند)
  const specs = [
    book.page_count && { icon: "📖", label: "تعداد صفحات", value: `${toFaNumber(book.page_count)} صفحه` },
    book.language && { icon: "🌐", label: "زبان", value: languageName(book.language) },
    book.publication_year && { icon: "📅", label: "سال انتشار", value: toFaYear(book.publication_year) },
    book.file_size && { icon: "💾", label: "حجم فایل", value: `PDF · ${formatFileSize(book.file_size)}` },
  ].filter(Boolean);

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-28">
      <div className="mx-auto w-full max-w-md">
        {/* ═══ نوار بالا ═══ */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          {/* در راست‌چین، «برگشت» سمت راست است و فلشش به راست اشاره می‌کند */}
          <button
            type="button"
            onClick={goBack}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="text-base font-bold text-gray-900">مشخصات کتاب</h1>
          {/* TODO (روز ۱۵): وقتی صفحه‌ی سبد خرید ساخته شد، این دکمه <Link to="/cart"> شود.
              تا آن موقع پیام می‌دهد، نه اینکه به صفحه‌ای برود که وجود ندارد. */}
          <button
            type="button"
            onClick={() => showToast(CART_SOON)}
            aria-label="سبد خرید"
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            🛒
          </button>
        </header>

        {/* ═══ جلد کتاب ═══ */}
        <section className="relative px-4 pb-6 pt-6">
          {/* هاله آبی ملایم پشت جلد */}
          <div className="absolute inset-x-10 top-10 h-56 rounded-full bg-blue-200/50 blur-3xl" />

          <div className="relative mx-auto w-44">
            {showCover ? (
              <img
                src={book.cover}
                alt={`جلد کتاب ${book.title}`}
                onError={() => setFailedCover(book.cover)}
                className="aspect-[2/3] w-full rounded-lg object-cover shadow-xl shadow-gray-900/20 ring-1 ring-black/5"
              />
            ) : (
              // اگر جلد آپلود نشده باشد (cover در مدل اختیاری است) یا تصویرش لود نشود
              <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 p-4 text-center text-lg font-bold leading-relaxed text-white shadow-xl">
                {book.title}
              </div>
            )}
          </div>

          {/* دکمه‌ی اشتراک، گوشه چپ (در راست‌چین، طرف مقابل دکمه برگشت) */}
          <div className="absolute left-4 top-6 flex flex-col gap-2">
            {/* TODO: دکمه‌ی «نشان کردن» (قلب) فعلاً پنهان است چون مدلی برای نشان‌شده‌ها در بکند نیست.
                وقتی ساخته شد: POST/DELETE /catalog/books/<id>/bookmark/، با به‌روزرسانی خوش‌بینانه
                (اول UI عوض شود و اگر درخواست شکست خورد برگردد). */}
            <button
              type="button"
              onClick={handleShare}
              aria-label="اشتراک‌گذاری"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              🔗
            </button>
          </div>
        </section>

        {/* ═══ عنوان و پدیدآورندگان ═══ */}
        <section className="px-5 text-center">
          {book.category && (
            // TODO: صفحه‌ی اصلی هنوز ?category را از آدرس نمی‌خواند (تب فعال فقط state است)،
            // پس این برچسب فعلاً لینک نیست. وقتی خواند: <Link to={`/?category=${book.category.id}`}>
            <span className="mb-3 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {book.category.name}
            </span>
          )}

          <h2 dir="auto" className="text-2xl font-bold leading-snug text-gray-900">{book.title}</h2>

          {/* عنوان اصلی برای کتاب‌های ترجمه‌شده، چپ‌به‌راست */}
          {book.original_title && (
            <p dir="ltr" className="mt-1 text-sm text-gray-400">
              {book.original_title}
            </p>
          )}

          <div className="mt-3 space-y-1 text-sm">
            <p className="text-gray-500">
              نویسنده: <span className="font-semibold text-blue-600">{joinNames(book.authors)}</span>
            </p>
            {isTranslated && (
              <p className="text-gray-500">
                مترجم: <span className="font-semibold text-gray-800">{joinNames(book.translators)}</span>
              </p>
            )}
          </div>
        </section>

        {/* ═══ کارت قیمت و کیف پول ═══ */}
        <section className="mx-4 mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-500">قیمت</span>
            {isFree ? (
              <span className="text-2xl font-bold text-green-600">رایگان</span>
            ) : (
              <span className="text-2xl font-bold text-blue-600">
                {toFaNumber(book.price)} <span className="text-sm font-medium">تومان</span>
              </span>
            )}
          </div>

          {/* موجودی کیف پول فقط وقتی معنا دارد که کتاب پولی است و هنوز خریده نشده،
              و فقط وقتی موجودی واقعاً گرفته شده باشد (فعلاً هرگز؛ TODO بالای کامپوننت) */}
          {!isFree && !isOwned && balance !== null && (
            <div
              className={`mt-4 flex items-center gap-3 rounded-xl p-3 ${
                shortage > 0 ? "bg-amber-50 ring-1 ring-amber-200" : "bg-gray-50"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg shadow-sm">
                👛
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">موجودی کیف پول</p>
                <p className="font-semibold text-gray-900">{toFaNumber(balance)} تومان</p>
                {shortage > 0 && (
                  <p className="mt-0.5 text-xs text-amber-700">
                    برای خرید {toFaNumber(shortage)} تومان کم دارید.
                  </p>
                )}
              </div>
              <Link
                to="/wallet"
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
              >
                شارژ کیف پول
              </Link>
            </div>
          )}

          {/* نمونه رایگان، فقط اگر فایل نمونه آپلود شده باشد.
              <a> معمولی است نه Link: یک فایل PDF روی سرور بک‌اند است، نه صفحه‌ای از خود برنامه. */}
          {book.sample_file && !isOwned && (
            <a
              href={book.sample_file}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 text-sm font-semibold text-blue-600 hover:bg-blue-50"
            >
              <span aria-hidden="true">📄</span>
              خواندن نمونه رایگان
            </a>
          )}
        </section>

        {/* ═══ مشخصات کلیدی ═══ */}
        {specs.length > 0 && (
          <section className="mx-4 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 shadow-sm">
            {specs.map((spec) => (
              <div key={spec.label} className="bg-white p-4">
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span aria-hidden="true">{spec.icon}</span>
                  {spec.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{spec.value}</p>
              </div>
            ))}
          </section>
        )}

        {/* ═══ درباره کتاب ═══ */}
        {book.description && (
          <section className="mx-4 mt-6">
            <h3 className="mb-2 text-lg font-bold text-gray-900">درباره کتاب</h3>
            <p
              dir="auto"
              className={`text-justify text-[15px] leading-8 text-gray-600 ${
                descExpanded ? "" : "line-clamp-5"
              }`}
            >
              {book.description}
            </p>
            {/* دکمه «بیشتر» فقط برای متن‌های بلند معنا دارد */}
            {book.description.length > 250 && (
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                aria-expanded={descExpanded}
                className="mt-1 text-sm font-semibold text-blue-600 hover:underline"
              >
                {descExpanded ? "نمایش کمتر" : "ادامه مطلب"}
              </button>
            )}
          </section>
        )}

        {/* ═══ شناسنامه کتاب ═══ */}
        <section className="mx-4 mt-6">
          <h3 className="mb-2 text-lg font-bold text-gray-900">شناسنامه کتاب</h3>
          <dl className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-4 text-sm shadow-sm">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-gray-500">شابک</dt>
              <dd className="flex items-center gap-2">
                {/* شابک همیشه چپ‌به‌راست؛ وگرنه در متن فارسی برعکس دیده می‌شود */}
                <span dir="ltr" className="font-mono tracking-wide text-gray-900">
                  {book.isbn}
                </span>
                <button
                  type="button"
                  onClick={handleCopyIsbn}
                  aria-label="کپی شابک"
                  className="rounded-md px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                >
                  کپی
                </button>
              </dd>
            </div>
            {book.publisher && (
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-gray-500">ناشر</dt>
                <dd dir="auto" className="font-medium text-gray-900">{book.publisher}</dd>
              </div>
            )}
            {book.edition && (
              <div className="flex justify-between gap-4 py-3">
                {/* همان برچسب فرم بارگذاری کتاب برای فیلد edition */}
                <dt className="text-gray-500">ویرایش</dt>
                <dd className="font-medium text-gray-900">{book.edition}</dd>
              </div>
            )}
            {isTranslated && (
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-gray-500">مترجم</dt>
                <dd className="font-medium text-gray-900">{joinNames(book.translators)}</dd>
              </div>
            )}
          </dl>

          {book.tags.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {book.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200">
                  # {tag}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ═══ نوار خرید چسبیده به پایین ═══
          این صفحه مثل بقیه‌ی صفحه‌های داخلی (فرم کتاب، درخواست شابک) نوار ناوبری پایین برنامه
          (BottomNavbar) را ندارد؛ آن نوار فقط در صفحه‌ی اصلی است. پس bottom-0 درست است.
          اگر روزی layout مشترکی با نوار پایین (ارتفاع h-14) برای همه‌ی صفحه‌ها ساخته شد،
          این نوار باید bottom-14 شود (و pb صفحه و جای toast هم به همان اندازه بالا برود). */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          {isOwned ? (
            // TODO (روز ۱۶-۱۷): مسیر خواندن کتاب خریداری‌شده هنوز نیست. فایل باید از endpointی
            // بیاید که مالکیت کاربر را چک می‌کند (مثلاً GET /catalog/books/<id>/download/).
            <Link
              to={`/library/${book.id}/read`}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 font-semibold text-white hover:bg-green-700"
            >
              <span aria-hidden="true">📖</span>
              خواندن کتاب
            </Link>
          ) : (
            <>
              <div className="shrink-0">
                <p className="text-xs text-gray-500">قیمت</p>
                <p className="font-bold text-gray-900">{formatPrice(book.price)}</p>
              </div>
              <button
                type="button"
                onClick={handleAddToCart}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
              >
                <span aria-hidden="true">🛒</span>
                {/* 🔌 برای کتاب رایگان بعداً می‌شود مستقیم به کتابخانه اضافه کرد،
                    بدون عبور از سبد خرید */}
                {isFree ? "افزودن به کتابخانه" : "افزودن به سبد خرید"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══ پیام کوتاه (toast) ═══ */}
      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// حالت‌های جانبی صفحه. داخل همین فایل مانده‌اند چون فقط اینجا استفاده می‌شوند.
// ─────────────────────────────────────────────────────────────

// اسکلت خاکستری هنگام بارگذاری؛ شکلش شبیه صفحه نهایی است تا صفحه بعد از
// رسیدن داده «پرش» نکند
function LoadingState() {
  return (
    <div dir="rtl" className="min-h-screen bg-gray-100" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="mx-auto max-w-md animate-pulse px-4 pt-20">
        <div className="mx-auto aspect-[2/3] w-44 rounded-lg bg-gray-300" />
        <div className="mx-auto mt-6 h-7 w-48 rounded bg-gray-300" />
        <div className="mx-auto mt-3 h-4 w-32 rounded bg-gray-200" />
        <div className="mt-6 h-24 rounded-2xl bg-gray-200" />
        <div className="mt-4 h-32 rounded-2xl bg-gray-200" />
      </div>
    </div>
  );
}

// onRetry (اختیاری): دکمه‌ی «تلاش دوباره»؛ فقط برای خطای شبکه/سرور، نه برای «پیدا نشد»
function MessageState({ emoji, title, text, onRetry }) {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-3 text-4xl">{emoji}</div>
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">{text}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700"
          >
            تلاش دوباره
          </button>
        )}
        <Link
          to="/"
          className={`flex h-11 items-center justify-center rounded-xl font-semibold ${
            onRetry
              ? "mt-2 text-blue-600 hover:bg-blue-50"
              : "mt-6 bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          بازگشت به فروشگاه
        </Link>
      </div>
    </div>
  );
}
