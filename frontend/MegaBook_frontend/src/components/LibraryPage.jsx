import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getLibrary, getLibrarySummary, getMyUploads } from "../api/library";
import { formatPrice, toFaNumber } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند (src/api/library.js)
//   GET /library/?page=n          ← کتاب‌های خریداری‌شده، جدیدترین خرید اول
//   GET /library/uploads/?page=n  ← کتاب‌های تأییدشدهٔ کاربر (برای خواندن). پیگیری همهٔ
//                                   بارگذاری‌ها، با گفتگو، در «درخواست‌ها و آپلودهای من» است.
//   GET /library/summary/         ← شمارندهٔ تب‌ها
// هر لیست با صفحه‌بندی DRF می‌آید ({ count, next, results })، شش کتاب در هر صفحه.
//
// کتاب خریداری‌شده حتی اگر بعداً از فروشگاه برداشته شود در کتابخانه می‌ماند و
// خواندنی است؛ بک‌اند کتابخانه را بر اساس وضعیت کتاب فیلتر نمی‌کند.
// کتاب‌هایی که کاربر خودش بارگذاری کرده فقط در تب «بارگذاری‌شده» می‌آیند، نه در خریداری‌شده.
// ═════════════════════════════════════════════════════════════

const TABS = [
  { key: "purchased", label: "خریداری‌شده" },
  { key: "uploaded", label: "بارگذاری‌شده" },
  { key: "bookmarked", label: "نشان‌شده" },
];

// TODO (bookmarks): the bookmark model has no backend yet; the tab stays empty until it does
const NO_BOOKMARKS = { count: 0, next: null, results: [] };

async function fetchTab(tab, page) {
  if (tab === "purchased") return getLibrary(page);
  if (tab === "uploaded") return getMyUploads(page);
  return NO_BOOKMARKS;
}

// DRF's `next` is a full URL; we only need its page number
function nextPageOf(data) {
  if (!data.next) return null;
  return Number(new URL(data.next).searchParams.get("page")) || null;
}

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
// The API sends authors as a list of names
const authorNames = (book) => (Array.isArray(book.authors) ? book.authors.join("، ") : book.authors);

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function LibraryPage() {
  // تب انتخاب‌شده در آدرس صفحه نگه داشته می‌شود (/library?tab=uploaded)
  // تا مثلاً کارت «بارگذاری‌شده» در داشبورد بتواند مستقیم به همین تب لینک بدهد،
  // و با رفرش صفحه تب عوض نشود.
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "purchased";
  const location = useLocation();
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [books, setBooks] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | more | error
  const [reloadKey, setReloadKey] = useState(0);

  // The cart page sends the user here after a purchase, with a success message
  const [toast, setToast] = useState(() =>
    location.state?.message ? { text: location.state.message, tone: "green" } : null
  );

  useEffect(() => {
    if (!location.state?.message) return;
    // Forget the message in the browser history, so a refresh or "back" doesn't show it again
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location, navigate]);

  // Hide any toast after a few seconds
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    getLibrarySummary()
      .then(setSummary)
      .catch(() => {}); // اگر شمارنده‌ها نیامدند، تب‌ها بدون عدد نمایش داده می‌شوند
  }, []);

  // ── گرفتن صفحهٔ اول تب فعلی ──
  useEffect(() => {
    let cancelled = false;
    fetchTab(tab, 1)
      .then((data) => {
        if (cancelled) return;
        setBooks(data.results);
        setNextPage(nextPageOf(data));
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  function changeTab(key) {
    if (key === tab) return;
    setStatus("loading");
    setBooks([]);
    // replace: switching tabs doesn't add entries to the browser's "back" history
    setParams({ tab: key }, { replace: true });
  }

  function retry() {
    setStatus("loading");
    setReloadKey((k) => k + 1);
  }

  async function handleLoadMore() {
    setStatus("more");
    try {
      const data = await fetchTab(tab, nextPage);
      setBooks((prev) => [...prev, ...data.results]);
      setNextPage(nextPageOf(data));
    } catch {
      setToast({ text: "بارگذاری کتاب‌های بیشتر ناموفق بود.", tone: "red" });
    }
    setStatus("ready");
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md">
        {/* ═══ نوار بالا ═══ */}
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-gray-100/90 backdrop-blur">
          <div className="flex h-14 items-center gap-1 px-2">
            <Link
              to="/"
              aria-label="بازگشت به فروشگاه"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200"
            >
              →
            </Link>
            <h1 className="text-lg font-bold text-gray-900">کتابخانهٔ من</h1>
          </div>

          {/* ═══ تب‌ها، با شمارنده ═══
              در طرح Visily سه کارت آمار جدا بالای تب‌ها بود که همان عددها را
              تکرار می‌کرد؛ عددها را داخل خود تب‌ها گذاشتیم. */}
          <div className="px-4 pb-3">
            <div role="tablist" aria-label="بخش‌های کتابخانه" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-200/70 p-1">
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => changeTab(t.key)}
                    className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
                      active ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t.label}
                    {/* null: no number yet (bookmarks have no backend) */}
                    {summary && summary[t.key] != null && (
                      <span
                        className={`rounded-full px-1.5 text-xs ${
                          active ? "bg-blue-50 text-blue-700" : "bg-gray-300/60 text-gray-600"
                        }`}
                      >
                        {toFaNumber(summary[t.key])}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <main className="px-4 pt-4">
          {/* دکمهٔ بارگذاری کتاب جدید فقط در تب «بارگذاری‌شده» */}
          {tab === "uploaded" && (
            <Link
              to="/books/new"
              className="mb-4 flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              <span aria-hidden="true">＋</span>
              بارگذاری کتاب جدید
            </Link>
          )}

          {status === "loading" && <GridSkeleton />}

          {status === "error" && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span>کتاب‌ها دریافت نشد.</span>
              <button
                type="button"
                onClick={retry}
                className="shrink-0 rounded-lg px-3 py-1.5 font-semibold hover:bg-red-100"
              >
                تلاش دوباره
              </button>
            </div>
          )}

          {(status === "ready" || status === "more") && books.length === 0 && <EmptyState tab={tab} />}

          {status !== "loading" && books.length > 0 && (
            <ul className="grid grid-cols-2 gap-3">
              {books.map((book) => (
                <li key={book.id}>
                  {tab === "purchased" && <PurchasedCard book={book} />}
                  {tab === "uploaded" && <UploadCard book={book} />}
                  {tab === "bookmarked" && <BookmarkCard book={book} />}
                </li>
              ))}
            </ul>
          )}

          {nextPage && status !== "loading" && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={status === "more"}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-sm font-semibold text-gray-600 hover:bg-white disabled:cursor-wait"
            >
              {status === "more" && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              )}
              {status === "more" ? "در حال بارگذاری…" : "نمایش کتاب‌های بیشتر"}
            </button>
          )}
        </main>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-6 z-40 mx-auto max-w-sm rounded-2xl px-4 py-3 text-center text-sm text-white shadow-lg ${
            toast.tone === "red" ? "bg-red-600" : toast.tone === "green" ? "bg-green-600" : "bg-gray-900"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

// جلد کتاب؛ اگر جلد نداشت، عنوان روی زمینهٔ آبی
function Cover({ book, dim = false }) {
  return (
    <div className={`aspect-[2/3] w-full overflow-hidden rounded-t-2xl bg-gray-100 ${dim ? "opacity-60" : ""}`}>
      {book.cover ? (
        <img src={book.cover} alt={`جلد ${book.title}`} className="h-full w-full object-cover" />
      ) : (
        <div
          dir="auto"
          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 p-3 text-center text-sm font-bold leading-relaxed text-white"
        >
          {book.title}
        </div>
      )}
    </div>
  );
}

// عنوان و نویسنده؛ dir="auto" چون کتاب انگلیسی هم داریم
function TitleBlock({ book }) {
  return (
    <>
      <p dir="auto" className="truncate text-sm font-semibold text-gray-900">
        {book.title}
      </p>
      <p dir="auto" className="mt-0.5 truncate text-xs text-gray-500">
        {authorNames(book)}
      </p>
    </>
  );
}

function PurchasedCard({ book }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
      <Link to={`/books/${book.id}`}>
        <Cover book={book} />
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <TitleBlock book={book} />
        <p className="mb-3 mt-1 text-[11px] text-gray-400">خرید: {formatDate(book.purchased_at)}</p>
        {/* The reader page opens the PDF and has the download button: the file needs a
            short-lived signed link, which that page fetches */}
        <Link
          to={`/library/${book.id}/read`}
          aria-label={`خواندن ${book.title}`}
          className="mt-auto flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-200 transition-colors hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50"
        >
          <span aria-hidden="true">📖</span>
          خواندن و دانلود
        </Link>
      </div>
    </article>
  );
}

// Only approved uploads reach the library (books to read). The whole card opens the
// book's page, where its uploader gets "read the book". Status, conversation, sales
// and earnings live on "My Requests & Uploads", not here.
function UploadCard({ book }) {
  return (
    <Link
      to={`/books/${book.id}`}
      className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50"
    >
      <Cover book={book} />
      <div className="flex flex-1 flex-col p-3">
        <TitleBlock book={book} />
        <p className="mt-1 text-xs font-semibold text-gray-700">{formatPrice(book.price)}</p>
      </div>
    </Link>
  );
}

// TODO (bookmarks): used once the bookmarks API exists
function BookmarkCard({ book }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
      <Link to={`/books/${book.id}`}>
        <Cover book={book} />
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <TitleBlock book={book} />
        <p className="mt-1 text-xs font-semibold text-blue-600">{formatPrice(book.price)}</p>
        <Link
          to={`/books/${book.id}`}
          className="mt-3 flex h-10 w-full items-center justify-center rounded-xl text-sm font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
        >
          مشاهده و خرید
        </Link>
      </div>
    </article>
  );
}

function EmptyState({ tab }) {
  const content = {
    purchased: { icon: "📚", text: "هنوز کتابی نخریده‌اید. کتاب‌هایی که می‌خرید اینجا جمع می‌شوند.", cta: "رفتن به فروشگاه", href: "/" },
    uploaded: { icon: "📤", text: "هنوز کتابی بارگذاری نکرده‌اید. با دکمهٔ بالا اولین کتابتان را برای فروش بگذارید.", cta: null },
    // TODO (bookmarks): "کتابی نشان نکرده‌اید. در صفحهٔ هر کتاب، با دکمهٔ قلب آن را اینجا نگه دارید."
    bookmarked: { icon: "🤍", text: "نشان کردن کتاب‌ها به‌زودی فعال می‌شود.", cta: "رفتن به فروشگاه", href: "/" },
  }[tab];

  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <span className="text-4xl" aria-hidden="true">{content.icon}</span>
      <p className="mt-3 text-sm leading-7 text-gray-500">{content.text}</p>
      {content.cta && (
        <Link
          to={content.href}
          className="mt-5 flex h-11 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {content.cta}
        </Link>
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <ul className="grid animate-pulse grid-cols-2 gap-3" aria-busy="true" aria-label="در حال بارگذاری">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="rounded-2xl border border-gray-200 bg-white">
          <div className="aspect-[2/3] rounded-t-2xl bg-gray-200" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-3 w-1/2 rounded bg-gray-100" />
            <div className="h-10 rounded-xl bg-gray-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}
