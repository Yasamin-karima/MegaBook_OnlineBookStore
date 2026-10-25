import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getMyRequests, getMyUploads } from "../api/dashboard";
import { getUnread } from "../api/support";
import useGoBack from "../hooks/useGoBack";

// ═════════════════════════════════════════════════════════════
// «درخواست‌ها و آپلودهای من»: زیرصفحهٔ داشبورد (/dashboard/my-items)، برای پیگیری.
// هر دو لیست یک کار می‌کنند: نشان دادن وضعیت و باز کردن گفتگو با پشتیبانی.
// کلیک روی هر کارت، ConversationPage همان مورد را باز می‌کند (/requests/:id و /uploads/:id).
//
// کتابخانه برای «خواندن» است؛ این صفحه برای «پیگیری». برای همین اینجا دکمهٔ دانلود
// نیست و سرور هیچ آدرس فایلی نمی‌فرستد (DECISIONS 11.4). درخواست هم پس گرفته یا حذف نمی‌شود.
//
// تب و فیلتر وضعیت در آدرس صفحه‌اند، تا داشبورد و صفحهٔ مبادله مستقیم لینک بدهند و
// با رفرش عوض نشوند:
//   /dashboard/my-items?tab=requests&status=open
//   /dashboard/my-items?tab=uploads&status=pending
//
// 🔌 بکند: src/api/dashboard.js (همان منطق شمارش داشبورد) و /support/unread/ برای نشان تب‌ها.
// ═════════════════════════════════════════════════════════════

const TABS = [
  { key: "requests", label: "درخواست‌ها" },
  { key: "uploads", label: "آپلودها" },
];

// فیلترهای وضعیت هر تب؛ مقادیر همان choices مدل‌ها هستند
const STATUS_FILTERS = {
  requests: [
    { key: "all", label: "همه" },
    { key: "open", label: "در جریان" },
    { key: "fulfilled", label: "تأمین شده" },
    { key: "rejected", label: "رد شده" },
  ],
  uploads: [
    { key: "all", label: "همه" },
    { key: "pending", label: "در انتظار تأیید" },
    { key: "approved", label: "تأیید شده" },
    { key: "rejected", label: "رد شده" },
  ],
};

const STATUS_BADGE = {
  open: { label: "در جریان", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  fulfilled: { label: "تأمین شده", className: "bg-green-50 text-green-700 ring-green-200" },
  pending: { label: "در انتظار تأیید", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { label: "تأیید شده", className: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "رد شده", className: "bg-red-50 text-red-700 ring-red-200" },
};

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════
const toFaNumber = (n) => Number(n).toLocaleString("fa-IR");
const toLatinDigits = (s) =>
  s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const displayIsbn = (isbn) => `${isbn.slice(0, 3)}-${isbn.slice(3)}`;

// DRF's `next` is a full URL; we only need its page number
function nextPageOf(data) {
  if (!data.next) return null;
  return Number(new URL(data.next).searchParams.get("page")) || null;
}

function fetchItems({ tab, status, search, page }) {
  const params = { status: status === "all" ? undefined : status, search, page };
  return tab === "requests" ? getMyRequests(params) : getMyUploads(params);
}

const rtf = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });
function timeAgo(iso) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
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
export default function MyRequestsUploadsPage() {
  const goBack = useGoBack();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((x) => x.key === params.get("tab")) ? params.get("tab") : "requests";
  const status = STATUS_FILTERS[tab].some((x) => x.key === params.get("status")) ? params.get("status") : "all";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [unread, setUnread] = useState(null);
  const searchRef = useRef(null);

  // The answer for one query: { key, status: "ready" | "error", items, count, nextPage }.
  // If its key isn't the current one, it belongs to an older tab/filter/search: loading.
  const queryKey = `${tab}|${status}|${search}|${reloadKey}`;
  const [result, setResult] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Unread totals per tab, for the red badges on the tabs (sum of the per-item counts)
  useEffect(() => {
    getUnread()
      .then((data) => {
        const sum = (map) => Object.values(map).reduce((s, n) => s + n, 0);
        setUnread({ requests: sum(data.requests), uploads: sum(data.uploads) });
      })
      .catch(() => {});
  }, []);

  // جستجو با debounce (مثل صفحهٔ مبادله)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(toLatinDigits(searchInput).trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    fetchItems({ tab, status, search, page: 1 })
      .then((data) => {
        if (cancelled) return;
        setResult({ key: queryKey, status: "ready", items: data.results, count: data.count, nextPage: nextPageOf(data) });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: queryKey, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, status, search, queryKey]);

  const current = result?.key === queryKey ? result : null;
  const items = current?.status === "ready" ? current.items : [];

  function changeTab(next) {
    if (next === tab) return;
    // با عوض شدن تب، فیلتر وضعیت و جستجو پاک می‌شوند، چون وضعیت‌های دو تب متفاوت‌اند
    setSearchInput("");
    setSearch("");
    setParams({ tab: next }, { replace: true });
  }

  function changeStatus(next) {
    setParams(next === "all" ? { tab } : { tab, status: next }, { replace: true });
  }

  async function handleLoadMore() {
    const key = queryKey;
    setLoadingMore(true);
    try {
      const data = await fetchItems({ tab, status, search, page: current.nextPage });
      setResult((prev) => (prev.key !== key ? prev : {
        ...prev,
        items: [...prev.items, ...data.results.filter((r) => !prev.items.some((p) => p.id === r.id))],
        nextPage: nextPageOf(data),
      }));
    } catch {
      /* دکمه می‌ماند و کاربر دوباره امتحان می‌کند */
    }
    setLoadingMore(false);
  }

  const filtered = status !== "all" || search !== "";
  const newHref = tab === "requests" ? "/requests/new" : "/books/new";

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      {/* md+: the full width beside the side nav; the cards go into a grid */}
      <div className="mx-auto w-full max-w-md md:max-w-none">
        {/* ═══ نوار بالا و تب‌ها ═══ */}
        <header className="sticky top-16 z-20 md:top-0 border-b border-gray-200 bg-gray-100/90 backdrop-blur">
          <div className="flex h-14 items-center justify-between px-2 md:px-4">
            <button
              type="button"
              onClick={goBack}
              aria-label="برگشت"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              →
            </button>
            <h1 className="text-base font-bold text-gray-900">درخواست‌ها و آپلودهای من</h1>
            {/* دکمهٔ ساخت مورد جدید، بسته به تب */}
            <Link
              to={newHref}
              aria-label={tab === "requests" ? "درخواست کتاب جدید" : "بارگذاری کتاب جدید"}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-2xl text-blue-600 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              ＋
            </Link>
          </div>

          <div className="px-4 pb-3 md:px-6">
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200/70 p-1 md:max-w-md">
              {TABS.map((x) => {
                const active = tab === x.key;
                const n = unread?.[x.key] ?? 0;
                return (
                  <button
                    key={x.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => changeTab(x.key)}
                    className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
                      active ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {x.label}
                    {/* نشان قرمز فقط برای پیام خوانده‌نشده؛ تعداد کل موردها را نشان نمی‌دهیم */}
                    {n > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white" aria-label={`${toFaNumber(n)} پیام خوانده‌نشده`}>
                        {toFaNumber(n)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* ═══ جستجو و فیلتر وضعیت ═══ */}
        {/* lg+: search and the status filters on one row */}
        <section className="px-4 pt-4 md:px-6 md:pt-6 lg:flex lg:items-center lg:gap-4">
          <div className="relative md:w-full md:max-w-md lg:max-w-xs xl:max-w-md">
            <label htmlFor="search" className="sr-only">جستجو</label>
            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              id="search"
              ref={searchRef}
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="عنوان یا شابک"
              className="h-12 w-full rounded-xl border border-gray-300 bg-white pl-4 pr-11 text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
          </div>

          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0 lg:mt-0 lg:pb-0" role="group" aria-label="فیلتر وضعیت">
            {STATUS_FILTERS[tab].map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={status === f.key}
                onClick={() => changeStatus(f.key)}
                className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
                  status === f.key ? "bg-gray-900 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {/* ═══ لیست ═══ */}
        <main className="mx-4 mt-3 md:mx-6 md:mt-4">
          {!current && <ListSkeleton />}

          {current?.status === "error" && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span>لیست دریافت نشد.</span>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0 rounded-lg px-3 py-1.5 font-semibold hover:bg-red-100">
                تلاش دوباره
              </button>
            </div>
          )}

          {current?.status === "ready" && items.length === 0 && (
            <EmptyState
              tab={tab}
              filtered={filtered}
              onClear={() => {
                setSearchInput("");
                setSearch("");
                changeStatus("all");
                searchRef.current?.focus();
              }}
            />
          )}

          {items.length > 0 && (
            <>
              {filtered && (
                <p className="mb-2 text-sm text-gray-500" aria-live="polite">{toFaNumber(current.count)} مورد</p>
              )}
              <ul className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3">
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} tab={tab} />
                ))}
              </ul>
            </>
          )}

          {current?.status === "ready" && current.nextPage && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-sm font-semibold text-gray-600 hover:bg-white disabled:cursor-wait md:mx-auto md:mt-6 md:max-w-xs"
            >
              {loadingMore && <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />}
              {loadingMore ? "در حال بارگذاری…" : "نمایش موارد بیشتر"}
            </button>
          )}
        </main>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

const SENDER_PREFIX = { me: "شما: ", support: "پشتیبانی: ", system: "" };

// The card itself opens the details page with the conversation. The "view the book"
// link is a separate element BESIDE that link (a link inside a link isn't valid HTML).
function ItemCard({ item, tab }) {
  const badge = STATUS_BADGE[item.status];
  const hasUnread = item.unread_count > 0;
  const href = tab === "requests" ? `/requests/${item.id}` : `/uploads/${item.id}`;
  const when = tab === "requests" ? item.requested_at : item.uploaded_at;

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm md:flex md:flex-col ${
        hasUnread ? "border-blue-200 ring-1 ring-blue-100" : "border-gray-200"
      }`}
    >
      <Link
        to={href}
        className="flex gap-3 p-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600/50 md:flex-1"
      >
        {item.cover ? (
          <img src={item.cover} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
        ) : (
          <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-100 to-blue-200 text-xl" aria-hidden="true">
            📘
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 dir="auto" className={`truncate leading-snug text-gray-900 ${hasUnread ? "font-bold" : "font-semibold"}`}>
              {item.title}
            </h2>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${badge.className}`}>{badge.label}</span>
          </div>
          {item.authors && <p dir="auto" className="mt-0.5 truncate text-sm text-gray-500">{item.authors}</p>}

          {/* آخرین پیام گفتگو؛ متن ساده (React آن را escape می‌کند) */}
          {item.last_message && (
            <p className={`mt-2 truncate text-sm ${hasUnread ? "font-medium text-gray-900" : "text-gray-500"}`}>
              <span className="text-gray-400">{SENDER_PREFIX[item.last_message.sender]}</span>
              {item.last_message.text}
            </p>
          )}

          {tab === "uploads" && item.status === "approved" && (
            // تعداد فروش از سفارش‌ها، درآمد از دفتر تراکنش‌های کیف پول
            <p className="mt-2 text-xs text-green-700">
              {toFaNumber(item.sales_count)} فروش · درآمد {toFaNumber(item.earnings)} تومان
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-400">
            <span className="flex min-w-0 items-center gap-2">
              <span dir="ltr" className="truncate font-mono">{displayIsbn(item.isbn)}</span>
              {item.conversation_closed && <span className="shrink-0">· گفتگو بسته</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span>{timeAgo(when)}</span>
              {hasUnread && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-bold text-white" aria-label={`${toFaNumber(item.unread_count)} پیام خوانده‌نشده`}>
                  {toFaNumber(item.unread_count)}
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>

      {/* صفحهٔ کتاب در فروشگاه: برای درخواست تأمین‌شده و آپلود تأییدشده */}
      {item.book_id && (
        <Link
          to={`/books/${item.book_id}`}
          className="flex h-10 items-center justify-center gap-1.5 border-t border-gray-100 text-sm font-semibold text-blue-700 hover:bg-blue-50"
        >
          مشاهدهٔ کتاب در فروشگاه
        </Link>
      )}
    </li>
  );
}

function EmptyState({ tab, filtered, onClear }) {
  if (filtered) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center md:mx-auto md:max-w-lg">
        <span className="text-3xl" aria-hidden="true">🔎</span>
        <p className="mt-2 text-sm text-gray-500">موردی با این فیلتر پیدا نشد.</p>
        <button type="button" onClick={onClear} className="mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50">
          پاک کردن فیلترها
        </button>
      </div>
    );
  }
  const c =
    tab === "requests"
      ? { icon: "📮", text: "هنوز کتابی درخواست نداده‌اید. در صفحهٔ مبادله ببینید دیگران چه کتاب‌هایی خواسته‌اند، یا کتابی را که پیدا نمی‌کنید درخواست دهید.", cta: "رفتن به مبادلهٔ کتاب", href: "/requests" }
      : { icon: "📤", text: "هنوز کتابی بارگذاری نکرده‌اید. کتاب خود را بارگذاری کنید و از هر فروش سهم بگیرید.", cta: "بارگذاری کتاب", href: "/books/new" };
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center md:mx-auto md:max-w-lg">
      <span className="text-4xl" aria-hidden="true">{c.icon}</span>
      <p className="mt-3 text-sm leading-7 text-gray-500">{c.text}</p>
      <Link to={c.href} className="mt-5 flex h-11 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700">
        {c.cta}
      </Link>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="animate-pulse space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 xl:grid-cols-3" aria-busy="true" aria-label="در حال بارگذاری">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex gap-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="h-20 w-14 rounded-md bg-gray-200" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-2/3 rounded bg-gray-200" />
            <div className="h-3 w-1/3 rounded bg-gray-100" />
            <div className="h-3 w-full rounded bg-gray-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}
