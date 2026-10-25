import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { checkReview, getAdminReviews, hideReview, unhideReview } from "../../api/admin";
import AdminShell from "./AdminShell";
import {
  Badge, FilterChips, ReasonField, SearchBox, Toast,
  errorMessage, formatDateTime, notifyCountsChanged, timeAgo, toFaNumber, useDebounced, useToast, useUrlParam,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «نظرها»
//
// جریان تصمیم‌گرفته‌شده:
//   • هر نظر همان لحظه منتشر می‌شود؛ ادمین بعداً می‌بیند، نه قبل از انتشار.
//   • اینجا فقط نظرهای متن‌دار می‌آیند (امتیاز تنها چیزی برای بررسی ندارد).
//   • جدیدترین ارسال اول. هر نظر «جدید» یا «بررسی‌شده» است.
//   • ویرایش نظر توسط نویسنده آن را دوباره «جدید» و بالای لیست می‌آورد.
//   • پنهان کردن دلیل اجباری دارد. نویسنده نظر پنهان‌شده و دلیلش را می‌بیند و اعلان
//     می‌گیرد (Review.hide در سرور)؛ اگر ویرایشش کند دوباره منتشر می‌شود و چرخه تکرار می‌شود.
//   • «نمایش دوباره» (تصمیم ۱۳.۳) پنهان‌سازی اشتباه را جبران می‌کند؛ نظر «بررسی‌شده» می‌شود.
//
// برخلاف بخش‌های دیگر، اینجا صف + جزئیات نداریم: متن کامل هر نظر در خود
// لیست است، چون بیشتر نظرها مشکلی ندارند و ادمین فقط باید سریع از آن‌ها رد
// شود. برای سرعت، کلید «ب» (یا b) روی کارت انتخاب‌شده «بررسی شد» را می‌زند.
// ═════════════════════════════════════════════════════════════

const FILTERS = [
  { key: "new", label: "جدید" },
  { key: "checked", label: "بررسی‌شده" },
  { key: "hidden", label: "پنهان‌شده" },
  { key: "all", label: "همه" },
];

// ═════════════════════════════════════════════════════════════
// اتصال به بکند (api/admin.js؛ فقط is_staff)
//
// GET  /admin-api/reviews/?filter=new|checked|hidden|all&search=  ← نظرها + new_count
//      فقط نظرهای متن‌دار، به ترتیب جدیدترین submitted_at (هر ویرایش نویسنده آن را جلو می‌برد).
//      «جدید» = بررسی‌نشده و پنهان‌نشده.
// POST /admin-api/reviews/<id>/check/ | hide/ {reason} | unhide/  ← نظر به‌روزشده
// ═════════════════════════════════════════════════════════════

// نظر در فیلتر فعلی می‌ماند؟ (بعد از هر کار، بدون صبر برای درخواست دوباره)
function inFilter(r, filter) {
  if (filter === "new") return !r.is_checked && !r.is_hidden;
  if (filter === "checked") return r.is_checked && !r.is_hidden;
  if (filter === "hidden") return r.is_hidden;
  return true;
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function AdminReviewsPage() {
  const [filter, setFilter] = useUrlParam("filter", "new", FILTERS.map((f) => f.key));
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);
  const [reviews, setReviews] = useState([]);
  const [newCount, setNewCount] = useState(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [toast, showToast] = useToast();

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s === "ready" ? "ready" : "loading"));
    getAdminReviews({ filter, search })
      .then((data) => {
        if (cancelled) return;
        setReviews(data.results);
        setNewCount(data.new_count);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [filter, search, reload]);

  // بعد از هر کار، اگر نظر از فیلتر فعلی بیرون رفت، همان لحظه از لیست برداشته
  // می‌شود (بدون صبر برای درخواست دوباره) و عدد منو به‌روز می‌شود
  function afterAction(updated) {
    const wasNew = reviews.some((r) => r.id === updated.id && !r.is_checked && !r.is_hidden);
    setReviews((list) => list.map((r) => (r.id === updated.id ? updated : r)).filter((r) => inFilter(r, filter)));
    if (wasNew && (updated.is_checked || updated.is_hidden)) setNewCount((n) => Math.max(0, (n ?? 1) - 1));
    notifyCountsChanged();
  }

  return (
    <AdminShell active="reviews">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 lg:p-6">
          <h1 className="text-lg font-bold text-gray-900">نظرها</h1>
          <p className="mt-1 text-sm text-gray-500">نظرها بلافاصله منتشر می‌شوند. فقط نظرهای متن‌دار اینجا می‌آیند.</p>

          <div className="mt-4 space-y-3">
            <SearchBox id="review-search" value={searchInput} onChange={setSearchInput} placeholder="متن نظر، عنوان کتاب یا نام نویسنده" />
            <FilterChips options={FILTERS} value={filter} onChange={setFilter} counts={{ new: newCount }} label="فیلتر نظرها" />
          </div>

          <div className="mt-4">
            {state === "loading" && <div className="h-40 animate-pulse rounded-2xl bg-gray-200" aria-busy="true" />}
            {state === "error" && (
              <div className="flex items-center justify-between rounded-xl bg-red-50 p-3 text-sm text-red-700">
                نظرها دریافت نشد.
                <button type="button" onClick={() => setReload((k) => k + 1)} className="font-semibold hover:underline">تلاش دوباره</button>
              </div>
            )}
            {state === "ready" && reviews.length === 0 && (
              <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-500">
                {filter === "new" && !search ? "🎉 نظر تازه‌ای برای بررسی نیست." : "نظری با این فیلتر پیدا نشد."}
              </p>
            )}
            <ul className="space-y-3">
              {reviews.map((r) => (
                <ReviewCard key={r.id} review={r} onDone={afterAction} showToast={showToast} />
              ))}
            </ul>
          </div>
        </div>
      </div>
      <Toast toast={toast} />
    </AdminShell>
  );
}

function Stars({ n }) {
  return (
    <span className="text-sm tracking-tight text-amber-400" aria-label={`امتیاز ${toFaNumber(n)} از ۵`}>
      {"★".repeat(n)}
      <span className="text-gray-200">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function ReviewCard({ review: r, onDone, showToast }) {
  const [hiding, setHiding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  async function run(fn, message) {
    setBusy(true);
    try {
      const updated = await fn();
      // فوکوس به کارت بعدی می‌رود تا با صفحه‌کلید پشت سر هم کار شود
      const next = ref.current?.nextElementSibling?.querySelector("[data-card]");
      setHiding(false);
      onDone(updated);
      showToast(message);
      next?.focus();
    } catch (err) {
      if (err.response?.status === 400) setError(err.response.data.reason?.[0]);
      else showToast(errorMessage(err), "red");
    } finally {
      setBusy(false);
    }
  }

  const check = () => run(() => checkReview(r.id), "بررسی شد.");
  const hide = () => {
    if (!reason.trim()) return setError("دلیل را بنویسید.");
    run(() => hideReview(r.id, reason.trim()), "نظر پنهان شد.");
  };
  const unhide = () => run(() => unhideReview(r.id), "نظر دوباره نمایش داده می‌شود.");

  const isNew = !r.is_checked && !r.is_hidden;

  return (
    <li ref={ref}>
      <article
        data-card
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || busy) return; // تایپ در فیلد دلیل را نگیرد
          if ((e.key === "ب" || e.key.toLowerCase() === "b") && isNew) check();
        }}
        className={`rounded-2xl border bg-white p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 ${
          isNew ? "border-blue-200" : "border-gray-200"
        } ${r.is_hidden ? "opacity-80" : ""}`}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Stars n={r.rating} />
            <Link to={`/admin/users?user=${r.author.id}`} className="text-sm font-semibold text-gray-900 hover:text-blue-700" title={r.author.full_name}>
              {r.author.display_name}
            </Link>
            <span className="text-xs text-gray-400">دربارهٔ</span>
            {/* کتابی که دیگر در فروشگاه نیست صفحهٔ عمومی ندارد؛ آن را در بررسی کتاب‌ها باز کن */}
            <Link
              to={r.book.status === "approved" ? `/books/${r.book.id}#reviews` : `/admin/books?status=all&book=${r.book.id}`}
              className="truncate text-sm text-blue-700 hover:underline"
            >
              {r.book.title}
            </Link>
          </div>
          <div className="flex items-center gap-1.5">
            {isNew && <Badge tone="blue">جدید</Badge>}
            {r.is_edited && <Badge tone="gray">ویرایش‌شده</Badge>}
            {r.is_hidden && <Badge tone="red">پنهان</Badge>}
            {!r.is_hidden && r.previously_hidden && <Badge tone="amber">قبلاً پنهان‌شده</Badge>}
            <span className="text-[11px] text-gray-400" title={formatDateTime(r.submitted_at)}>{timeAgo(r.submitted_at)}</span>
          </div>
        </header>

        <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-800">{r.body}</p>

        {r.is_hidden && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">دلیل پنهان شدن: {r.hide_reason}</p>
        )}

        {hiding ? (
          <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3">
            <ReasonField
              id={`hide-${r.id}`}
              label="دلیل پنهان کردن"
              value={reason}
              onChange={(v) => { setReason(v); setError(""); }}
              error={error}
              warning="⚠️ نویسنده این دلیل را کنار نظر پنهان‌شده‌اش می‌بیند."
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setHiding(false)} className="h-9 rounded-lg px-3 text-sm font-semibold text-gray-600 hover:bg-white">انصراف</button>
              <button type="button" onClick={hide} disabled={busy} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">پنهان کردن</button>
            </div>
          </div>
        ) : (
          <footer className="mt-3 flex justify-end gap-2">
            {!r.is_hidden ? (
              <>
                <button type="button" onClick={() => setHiding(true)} className="h-9 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50">پنهان کردن…</button>
                {isNew && (
                  <button type="button" onClick={check} disabled={busy} className="h-9 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
                    ✓ بررسی شد <kbd className="mr-1 rounded bg-white/20 px-1 text-[10px]">ب</kbd>
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={unhide} disabled={busy} className="h-9 rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                نمایش دوباره
              </button>
            )}
          </footer>
        )}
      </article>
    </li>
  );
}
