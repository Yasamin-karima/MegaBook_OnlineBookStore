import { useEffect, useRef, useState } from "react";
import AdminShell from "./AdminShell";
import {
  Badge, FilterChips, ReasonField, SearchBox, Toast,
  clone, formatDateTime, httpError, notifyCountsChanged, timeAgo, toFaNumber,
  useDebounced, useToast, useUrlParam, wait,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «نظرها»
//
// جریان تصمیم‌گرفته‌شده:
//   • هر نظر همان لحظه منتشر می‌شود؛ ادمین بعداً می‌بیند، نه قبل از انتشار.
//   • اینجا فقط نظرهای متن‌دار می‌آیند (امتیاز تنها چیزی برای بررسی ندارد).
//   • جدیدترین ارسال اول. هر نظر «جدید» یا «بررسی‌شده» است.
//   • ویرایش نظر توسط نویسنده آن را دوباره «جدید» و بالای لیست می‌آورد.
//   • پنهان کردن دلیل اجباری دارد. نویسنده نظر پنهان‌شده و دلیلش را می‌بیند؛
//     اگر ویرایشش کند دوباره منتشر می‌شود و چرخه تکرار می‌شود.
//
// برخلاف بخش‌های دیگر، اینجا صف + جزئیات نداریم: متن کامل هر نظر در خود
// لیست است، چون بیشتر نظرها مشکلی ندارند و ادمین فقط باید سریع از آن‌ها رد
// شود. برای سرعت، کلید «ب» (یا b) روی کارت انتخاب‌شده «بررسی شد» را می‌زند.
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// داده ماک (Mock)
// ═════════════════════════════════════════════════════════════
const HOUR = 60 * 60 * 1000;
const t = (h) => new Date(Date.now() - h * HOUR).toISOString();

let MOCK_REVIEWS = [
  { id: 91, book: { id: 12, title: "کتابخانه نیمه‌شب" }, author: { id: 11, display_name: "نیما ص." }, rating: 5, text: "یکی از بهترین کتاب‌هایی که امسال خواندم. ترجمه روان است و فایل هم کیفیت خوبی دارد.", status: "visible", checked: false, edited: false, hidden_reason: "", submitted_at: t(2) },
  { id: 90, book: { id: 21, title: "صد سال تنهایی" }, author: { id: 12, display_name: "سارا م." }, rating: 1, text: "این کتاب مزخرف است، نویسنده‌اش هم همین‌طور. برای خرید ارزان به کانال من در تلگرام بیایید: @cheap_books", status: "visible", checked: false, edited: false, hidden_reason: "", submitted_at: t(5) },
  { id: 89, book: { id: 42, title: "یادداشت‌های من" }, author: { id: 8, display_name: "رضا م." }, rating: 3, text: "محتوا خوب است ولی چند صفحه تکراری دارد.", status: "visible", checked: false, edited: true, hidden_reason: "", submitted_at: t(9) },
  { id: 88, book: { id: 12, title: "کتابخانه نیمه‌شب" }, author: { id: 3, display_name: "یاسمین ک." }, rating: 4, text: "پایانش را دوست نداشتم، ولی ارزش خواندن دارد.", status: "visible", checked: true, edited: false, hidden_reason: "", submitted_at: t(40) },
  { id: 87, book: { id: 21, title: "صد سال تنهایی" }, author: { id: 14, display_name: "مهسا ک." }, rating: 2, text: "لینک دانلود رایگان: example.com/free", status: "hidden", checked: true, edited: false, hidden_reason: "تبلیغ و لینک به سایت دیگر مجاز نیست.", submitted_at: t(70) },
];

const FILTERS = [
  { key: "new", label: "جدید" },
  { key: "checked", label: "بررسی‌شده" },
  { key: "hidden", label: "پنهان‌شده" },
  { key: "all", label: "همه" },
];

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند (فقط is_staff). آدرس‌ها پیشنهادی‌اند.
// ═════════════════════════════════════════════════════════════

// GET /api/admin/reviews/?filter=new|checked|hidden|all&search=&page=
//   queryset پایه: Review.objects.exclude(text="")   ← فقط نظرهای متن‌دار
//   ترتیب: -submitted_at  (submitted_at با هر ویرایش نویسنده به‌روز می‌شود)
//   «جدید» = checked=False و status=visible
async function fetchReviews({ filter, search }) {
  await wait(450);
  const q = search.trim();
  const rows = MOCK_REVIEWS.filter((r) =>
    filter === "new" ? !r.checked && r.status === "visible" : filter === "checked" ? r.checked && r.status === "visible" : filter === "hidden" ? r.status === "hidden" : true
  )
    .filter((r) => !q || r.text.includes(q) || r.book.title.includes(q) || r.author.display_name.includes(q))
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  return { results: clone(rows), new_count: MOCK_REVIEWS.filter((r) => !r.checked && r.status === "visible").length };
}

// POST /api/admin/reviews/<id>/check/
async function checkReview(id) {
  await wait(250);
  MOCK_REVIEWS.find((r) => r.id === id).checked = true;
}

// POST /api/admin/reviews/<id>/hide/   { reason }
// نظر از صفحهٔ کتاب برداشته می‌شود و از میانگین امتیاز هم بیرون می‌رود.
// TODO(اعلان): اعلان «نظر شما پنهان شد» همراه دلیل، برای نویسنده
//   (خواستهٔ صریح؛ فراموش نشود)
async function hideReview(id, reason) {
  await wait(500);
  if (!reason.trim()) throw httpError(400, { reason: ["دلیل لازم است."] });
  Object.assign(MOCK_REVIEWS.find((r) => r.id === id), { status: "hidden", checked: true, hidden_reason: reason.trim() });
}

// POST /api/admin/reviews/<id>/unhide/
// ⚠️ این امکان در تصمیم‌ها نبود؛ برای جبران پنهان‌سازی اشتباه اضافه شده.
// اگر نمی‌خواهید، این تابع و دکمه‌اش را حذف کنید.
async function unhideReview(id) {
  await wait(400);
  Object.assign(MOCK_REVIEWS.find((r) => r.id === id), { status: "visible", hidden_reason: "" });
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
    fetchReviews({ filter, search })
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
  function afterAction(id, patch) {
    setReviews((list) =>
      list
        .map((r) => (r.id === id ? { ...r, ...patch } : r))
        .filter((r) =>
          filter === "new" ? !r.checked && r.status === "visible" : filter === "checked" ? r.checked && r.status === "visible" : filter === "hidden" ? r.status === "hidden" : true
        )
    );
    if (patch.checked && filter === "new") setNewCount((n) => Math.max(0, (n ?? 1) - 1));
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

  async function run(fn, patch, message) {
    setBusy(true);
    try {
      await fn();
      // فوکوس به کارت بعدی می‌رود تا با صفحه‌کلید پشت سر هم کار شود
      const next = ref.current?.nextElementSibling?.querySelector("[data-card]");
      onDone(r.id, patch);
      showToast(message);
      next?.focus();
    } catch (err) {
      if (err.response?.status === 400) setError(err.response.data.reason?.[0]);
      else showToast("انجام نشد.", "red");
    } finally {
      setBusy(false);
    }
  }

  const check = () => run(() => checkReview(r.id), { checked: true }, "بررسی شد.");
  const hide = () => {
    if (!reason.trim()) return setError("دلیل را بنویسید.");
    run(() => hideReview(r.id, reason), { status: "hidden", checked: true, hidden_reason: reason.trim() }, "نظر پنهان شد.");
  };
  const unhide = () => run(() => unhideReview(r.id), { status: "visible", hidden_reason: "" }, "نظر دوباره نمایش داده می‌شود.");

  const isNew = !r.checked && r.status === "visible";

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
        } ${r.status === "hidden" ? "opacity-80" : ""}`}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Stars n={r.rating} />
            <span className="text-sm font-semibold text-gray-900">{r.author.display_name}</span>
            <span className="text-xs text-gray-400">دربارهٔ</span>
            <a href={`/books/${r.book.id}`} className="truncate text-sm text-blue-700 hover:underline">{r.book.title}</a>
          </div>
          <div className="flex items-center gap-1.5">
            {isNew && <Badge tone="blue">جدید</Badge>}
            {r.edited && <Badge tone="gray">ویرایش‌شده</Badge>}
            {r.status === "hidden" && <Badge tone="red">پنهان</Badge>}
            <span className="text-[11px] text-gray-400" title={formatDateTime(r.submitted_at)}>{timeAgo(r.submitted_at)}</span>
          </div>
        </header>

        <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-800">{r.text}</p>

        {r.status === "hidden" && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">دلیل پنهان شدن: {r.hidden_reason}</p>
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
            {r.status === "visible" ? (
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
