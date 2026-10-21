import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { isLoggedIn } from "../api/auth";
import { getPublicRequests, joinRequest } from "../api/bookRequests";
import { toFaNumber } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند (src/api/bookRequests.js)
//   GET  /book-requests/?ordering=newest|most_requested&search=…&page=n   (بدون ورود)
//   POST /book-requests/<id>/join/   «من هم می‌خواهم» (با ورود؛ تکرارش بی‌اثر است)
//
// هر ردیف یک BookRequest است (یک ردیف برای هر شابک). فقط درخواست‌های «در انتظار
// تأمین» می‌آیند: تأمین‌شده‌ها در فروشگاه‌اند و ردشده‌ها کاری برای تأمین‌کننده ندارند.
// از درخواست‌کننده‌ها فقط «تعداد» می‌آید؛ نه نام، نه ایمیل، نه شناسه (DECISIONS 5.11).
// ═════════════════════════════════════════════════════════════

const SORTS = [
  { key: "newest", label: "جدیدترین" },
  { key: "most_requested", label: "پرطرفدارترین" },
];

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════

// ارقام فارسی جستجو را لاتین می‌کند تا جستجوی شابک با کیبورد فارسی هم کار کند
const toLatinDigits = (s) =>
  s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

// همان قالب نمایش شابک صفحهٔ درخواست: «978-0198520115»
const displayIsbn = (isbn) => `${isbn.slice(0, 3)}-${isbn.slice(3)}`;

// DRF's `next` is a full URL; we only need its page number
function nextPageOf(data) {
  if (!data.next) return null;
  return Number(new URL(data.next).searchParams.get("page")) || null;
}

// زمان نسبی فارسی با Intl.RelativeTimeFormat: «۲ ساعت پیش»، «دیروز»، «۳ هفته پیش»
// numeric: "auto" باعث می‌شود به‌جای «۱ روز پیش» بنویسد «دیروز».
const rtf = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });
function timeAgo(iso) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000); // منفی یعنی گذشته
  const abs = Math.abs(minutes);
  if (abs < 60) return rtf.format(Math.min(minutes, -1), "minute");
  if (abs < 60 * 24) return rtf.format(Math.round(minutes / 60), "hour");
  if (abs < 60 * 24 * 7) return rtf.format(Math.round(minutes / (60 * 24)), "day");
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(minutes / (60 * 24 * 7)), "week");
  return rtf.format(Math.round(minutes / (60 * 24 * 30)), "month");
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function PublicRequestsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // searchInput همان چیزی است که کاربر تایپ می‌کند (هر کلید)؛
  // search مقداری است که واقعاً با آن درخواست می‌زنیم (با تأخیر).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState("newest");
  const [reloadKey, setReloadKey] = useState(0);

  // The answer for one query: { key, status: "ready" | "error", requests, count, nextPage }.
  // If its key isn't the current query's key, the answer is for an older search: loading.
  const queryKey = `${ordering}|${search}|${reloadKey}`;
  const [result, setResult] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // The request whose confirmation dialog is open (null: closed)
  const [confirming, setConfirming] = useState(null);
  const [joining, setJoining] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  // ── Debounce: تا کاربر ۴۰۰ میلی‌ثانیه تایپ نکرده، درخواست نمی‌زنیم ──
  // بدون این، تایپ «سمفونی» شش درخواست جدا به سرور می‌فرستاد.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(toLatinDigits(searchInput).trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── گرفتن صفحهٔ اول؛ با عوض شدن جستجو یا مرتب‌سازی از نو ──
  useEffect(() => {
    let cancelled = false;
    getPublicRequests({ ordering, search, page: 1 })
      .then((data) => {
        if (cancelled) return;
        setResult({ key: queryKey, status: "ready", requests: data.results, count: data.count, nextPage: nextPageOf(data) });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: queryKey, status: "error" });
      });
    // اگر پاسخ جستجوی «سمف» دیرتر از «سمفونی» برسد، نادیده گرفته می‌شود
    return () => {
      cancelled = true;
    };
  }, [ordering, search, queryKey]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const current = result?.key === queryKey ? result : null;
  const loading = !current;
  const requests = current?.status === "ready" ? current.requests : [];

  function showToast(text) {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    const key = queryKey;
    try {
      const data = await getPublicRequests({ ordering, search, page: current.nextPage });
      // The search or sort changed meanwhile: this page belongs to the old list
      setResult((prev) => prev.key !== key ? prev : ({
        ...prev,
        requests: [...prev.requests, ...data.results.filter((r) => !prev.requests.some((p) => p.id === r.id))],
        count: data.count,
        nextPage: nextPageOf(data),
      }));
    } catch {
      showToast("بارگذاری درخواست‌های بیشتر ناموفق بود.");
    }
    setLoadingMore(false);
  }

  async function handleCopyIsbn(isbn) {
    try {
      await navigator.clipboard.writeText(isbn);
      showToast("شابک کپی شد.");
    } catch {
      /* مرورگر اجازهٔ کپی نداد */
    }
  }

  // «من هم می‌خواهم»: مهمان به صفحهٔ ورود می‌رود؛ کاربر واردشده اول پنجرهٔ تأیید را می‌بیند
  function askToJoin(request) {
    if (!isLoggedIn()) {
      navigate("/login", { state: { from: location } });
      return;
    }
    setConfirming(request);
  }

  function replaceRequest(id, change) {
    setResult((prev) => ({ ...prev, requests: prev.requests.map((r) => (r.id === id ? change(r) : r)) }));
  }

  async function handleConfirmJoin() {
    const request = confirming;
    setJoining(true);
    try {
      const data = await joinRequest(request.id);
      // The card's new state comes from the server: count and "requested by you"
      replaceRequest(request.id, (r) => data.request ?? { ...r, is_mine: true });
      showToast(data.message);
      setConfirming(null);
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      setConfirming(null);
      if (status === 401) {
        navigate("/login", { state: { from: location } });
      } else if (status === 409 && data?.message) {
        showToast(data.message);
        if (data.result === "not_open") {
          // No longer open: it doesn't belong on this list anymore
          setResult((prev) => ({
            ...prev,
            requests: prev.requests.filter((r) => r.id !== request.id),
            count: Math.max(0, prev.count - 1),
          }));
        } else if (data.result === "in_review") {
          replaceRequest(request.id, (r) => ({ ...r, book_in_review: true }));
        }
      } else if (status === 404) {
        showToast("این درخواست پیدا نشد.");
      } else {
        showToast("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
      }
    } finally {
      setJoining(false);
    }
  }

  const isSearching = search !== "";

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md">
        {/* ═══ نوار بالا ═══ */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <Link
            to="/"
            aria-label="بازگشت به فروشگاه"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200"
          >
            →
          </Link>
          <h1 className="text-lg font-bold text-gray-900">مبادلهٔ کتاب</h1>
        </header>

        {/* ═══ معرفی و دو اقدام اصلی ═══
            در طرح Visily دو دکمهٔ تمام‌عرض با رنگ‌های کم‌کنتراست بود. اینجا
            کنار هم‌اند: درخواست (اقدام اصلی، آبی) و بارگذاری (اقدام دوم، سفید). */}
        <section className="mx-4 mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm leading-7 text-gray-600">
            کتاب‌هایی که کاربران می‌خواهند و هنوز در مگابوک نیست. اگر یکی از آن‌ها را دارید،
            بارگذاری کنید و پس از تأیید، از هر فروشش سهم بگیرید.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              to="/requests/new"
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
            >
              <span aria-hidden="true">＋</span>
              درخواست کتاب
            </Link>
            <Link
              to="/books/new"
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50"
            >
              <span aria-hidden="true">⬆️</span>
              بارگذاری کتاب
            </Link>
          </div>
        </section>

        {/* ═══ جستجو و مرتب‌سازی ═══ */}
        <section className="mx-4 mt-4">
          <div className="relative">
            <label htmlFor="search" className="sr-only">
              جستجو در درخواست‌ها
            </label>
            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
              🔍
            </span>
            <input
              id="search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="عنوان، نویسنده یا شابک"
              className="h-12 w-full rounded-xl border border-gray-300 bg-white pl-4 pr-11 text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-gray-500" aria-live="polite">
              {current?.status !== "ready"
                ? " "
                : isSearching
                ? `${toFaNumber(current.count)} نتیجه`
                : `${toFaNumber(current.count)} درخواست فعال`}
            </p>
            <div role="group" aria-label="مرتب‌سازی" className="flex rounded-lg bg-gray-200/70 p-0.5">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={ordering === s.key}
                  onClick={() => setOrdering(s.key)}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
                    ordering === s.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ لیست درخواست‌ها ═══ */}
        <main className="mx-4 mt-3">
          {loading && <ListSkeleton />}

          {current?.status === "error" && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span>درخواست‌ها دریافت نشد.</span>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="shrink-0 rounded-lg px-3 py-1.5 font-semibold hover:bg-red-100"
              >
                تلاش دوباره
              </button>
            </div>
          )}

          {current?.status === "ready" && requests.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <span className="text-4xl" aria-hidden="true">{isSearching ? "🔎" : "📭"}</span>
              <p className="mt-3 text-sm leading-7 text-gray-500">
                {isSearching
                  ? "درخواستی با این مشخصات نیست. اگر این کتاب را می‌خواهید، خودتان درخواستش را ثبت کنید."
                  : "فعلاً درخواست بازی نیست."}
              </p>
              <Link
                to="/requests/new"
                className="mt-5 flex h-11 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700"
              >
                درخواست کتاب
              </Link>
            </div>
          )}

          {requests.length > 0 && (
            <ul className="space-y-3">
              {requests.map((r) => (
                <RequestCard
                  key={r.id}
                  request={r}
                  onCopyIsbn={() => handleCopyIsbn(r.isbn)}
                  onJoin={() => askToJoin(r)}
                />
              ))}
            </ul>
          )}

          {current?.status === "ready" && current.nextPage && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-sm font-semibold text-gray-600 hover:bg-white disabled:cursor-wait"
            >
              {loadingMore && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              )}
              {loadingMore ? "در حال بارگذاری…" : "نمایش درخواست‌های بیشتر"}
            </button>
          )}
        </main>
      </div>

      {confirming && (
        <ConfirmJoinDialog
          request={confirming}
          busy={joining}
          onConfirm={handleConfirmJoin}
          onCancel={() => setConfirming(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-6 z-50 mx-auto max-w-sm rounded-2xl bg-gray-900 px-4 py-3 text-center text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

function RequestCard({ request: r, onCopyIsbn, onJoin }) {
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex gap-3">
        {/* جلد از Open Library؛ اگر نبود یا بارگذاری نشد، جایگزین آبی */}
        {r.cover && !coverFailed ? (
          <img
            src={r.cover}
            alt=""
            onError={() => setCoverFailed(true)}
            className="h-24 w-16 shrink-0 rounded-md object-cover shadow-sm ring-1 ring-black/5"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-100 to-blue-200 text-2xl"
          >
            📘
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {/* عنوان و نویسنده ممکن است انگلیسی باشند؛ dir="auto" */}
            <h2 dir="auto" className="line-clamp-2 font-bold leading-snug text-gray-900">
              {r.title}
            </h2>
            {r.is_mine && (
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200">
                درخواست شما
              </span>
            )}
          </div>
          {r.authors && (
            <p dir="auto" className="mt-0.5 truncate text-sm text-gray-500">
              {r.authors}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <button
              type="button"
              onClick={onCopyIsbn}
              aria-label={`کپی شابک ${r.isbn}`}
              title="کپی شابک"
              className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              <span>شابک</span>
              {/* شابک همیشه چپ‌به‌راست */}
              <span dir="ltr" className="font-mono text-gray-700">
                {displayIsbn(r.isbn)}
              </span>
            </button>
            <span>{timeAgo(r.created_at)}</span>
            {/* فقط تعداد؛ هیچ اطلاعاتی از خود درخواست‌کننده‌ها نمی‌آید */}
            <span className="flex items-center gap-1">
              <span aria-hidden="true">👥</span>
              {toFaNumber(r.requester_count)} نفر خواسته‌اند
            </span>
          </div>
        </div>
      </div>

      {/* ── اقدام تأمین‌کننده (اصلی) ── */}
      {r.book_in_review ? (
        // کسی همین کتاب را بارگذاری کرده و ادمین در حال بررسی آن است.
        // فرم بارگذاری هم این شابک را رد می‌کند (تصمیم ۵.۱۰)، پس دکمه را نشان نمی‌دهیم.
        <p className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-amber-50 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
          <span aria-hidden="true">⏳</span>
          این کتاب بارگذاری شده و در حال بررسی است
        </p>
      ) : (
        // فرم بارگذاری با شابک از پیش پرشده باز می‌شود. مسیرش محافظت‌شده است، پس مهمان
        // اول به صفحهٔ ورود می‌رود و بعد از ورود به همین فرم (با همین شابک) برمی‌گردد.
        <Link
          to={`/books/new?isbn=${r.isbn}`}
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
        >
          <span aria-hidden="true">⬆️</span>
          این کتاب را دارم، بارگذاری می‌کنم
        </Link>
      )}

      {/* ── «من هم می‌خواهم» (فرعی) ──
          عمداً یک دکمهٔ متنی کوچک و کم‌رنگ، تا با دکمهٔ اصلی اشتباه گرفته نشود و
          تصادفی زده نشود؛ زدنش هم فقط پنجرهٔ تأیید را باز می‌کند. */}
      <div className="mt-2 flex justify-center">
        {r.is_mine ? (
          <p className="flex items-center gap-1 py-1.5 text-xs text-blue-700">
            <span aria-hidden="true">✓</span>
            شما این کتاب را درخواست داده‌اید
          </p>
        ) : (
          <button
            type="button"
            onClick={onJoin}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 underline-offset-4 hover:bg-gray-50 hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            من هم این کتاب را می‌خواهم
          </button>
        )}
      </div>
    </li>
  );
}

// پنجرهٔ تأیید «من هم می‌خواهم». فقط «تأیید» درخواست می‌فرستد؛ «انصراف»، Escape و کلیک
// بیرون از پنجره فقط آن را می‌بندند. فوکوس اول روی «انصراف» است تا Enter تصادفی چیزی نفرستد.
function ConfirmJoinDialog({ request: r, busy, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  // Focus once, when the dialog opens
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="join-title" className="text-base font-bold text-gray-900">
          درخواست این کتاب
        </h2>
        <dl className="mt-4 space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 text-gray-500">عنوان:</dt>
            <dd dir="auto" className="font-semibold text-gray-900">{r.title}</dd>
          </div>
          {r.authors && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-gray-500">نویسنده:</dt>
              <dd dir="auto" className="text-gray-800">{r.authors}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="shrink-0 text-gray-500">شابک:</dt>
            <dd dir="ltr" className="font-mono text-gray-800">{displayIsbn(r.isbn)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-7 text-gray-600">
          مطمئن هستید که می‌خواهید این کتاب را درخواست کنید؟ وقتی کتاب در فروشگاه قرار بگیرد، می‌توانید آن را بخرید.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 rounded-xl text-sm font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-70"
          >
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            تأیید
          </button>
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="animate-pulse space-y-3" aria-busy="true" aria-label="در حال بارگذاری">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex gap-3">
            <div className="h-24 w-16 rounded-md bg-gray-200" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-100" />
              <div className="h-5 w-40 rounded bg-gray-100" />
            </div>
          </div>
          <div className="mt-4 h-11 rounded-xl bg-gray-100" />
        </li>
      ))}
    </ul>
  );
}
