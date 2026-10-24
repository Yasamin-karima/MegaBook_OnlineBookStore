import { useCallback, useEffect, useRef, useState } from "react";

// ═════════════════════════════════════════════════════════════
// ابزارهای مشترک صفحه‌های ادمین.
// چون هفت صفحهٔ ادمین همین تابع‌ها و تکه‌ها را لازم دارند، یک بار اینجا
// نوشته شده‌اند تا اگر چیزی عوض شد (مثلاً قالب تاریخ) فقط یک جا عوض شود.
// ═════════════════════════════════════════════════════════════

// ── اعداد و متن ──
export const toFaNumber = (n) => Number(n).toLocaleString("fa-IR");
export const formatToman = (n) => (n === 0 ? "رایگان" : `${toFaNumber(n)} تومان`);
export const toLatinDigits = (s) =>
  String(s)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
export const displayIsbn = (isbn) => `${isbn.slice(0, 3)}-${isbn.slice(3)}`;
// شمارهٔ کارت در گروه‌های چهارتایی: «6037 9911 2345 6789»
export const displayCard = (card) => card.replace(/(\d{4})(?=\d)/g, "$1 ");

// ── زمان ──
export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString("fa-IR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });

const rtf = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });
export function timeAgo(iso) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const abs = Math.abs(minutes);
  if (abs < 60) return rtf.format(Math.min(minutes, -1), "minute");
  if (abs < 60 * 24) return rtf.format(Math.round(minutes / 60), "hour");
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(minutes / (60 * 24)), "day");
  return rtf.format(Math.round(minutes / (60 * 24 * 30)), "month");
}

// ── شبیه‌سازی شبکه برای ماک‌ها ──
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const clone = (x) => structuredClone(x);
export function httpError(status, data) {
  const e = new Error(`HTTP ${status}`);
  e.response = { status, data };
  return e;
}
// خطای 400 DRF به شکل { field: ["پیام"] } را به { field: "پیام" } تبدیل می‌کند
export const fieldErrors = (data = {}) =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));

// ── hookها ──

// مقداری که فقط بعد از اینکه کاربر چند صد میلی‌ثانیه تایپ نکرد عوض می‌شود
export function useDebounced(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// پیام کوتاه پایین صفحه: const [toast, showToast] = useToast(); ... <Toast toast={toast} />
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text, tone = "dark") => {
    clearTimeout(timer.current);
    setToast({ text, tone });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

// state هم‌گام با آدرس صفحه. مقدار اولیه از ?key= خوانده می‌شود و هر تغییر
// با replaceState در آدرس نوشته می‌شود (بدون بارگذاری دوباره).
// 🔌 با react-router می‌شود همین را با useSearchParams نوشت.
export function useUrlParam(key, fallback, allowed) {
  const [value, setValue] = useState(() => {
    const v = new URLSearchParams(window.location.search).get(key);
    if (v === null) return fallback;
    if (allowed && !allowed.includes(v)) return fallback;
    return typeof fallback === "number" || fallback === null ? Number(v) || fallback : v;
  });
  const update = useCallback(
    (next) => {
      setValue(next);
      const p = new URLSearchParams(window.location.search);
      if (next === null || next === fallback) p.delete(key);
      else p.set(key, String(next));
      const qs = p.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    },
    [key, fallback]
  );
  return [value, update];
}

// خبر دادن به منوی کناری که عددهای «کار منتظر» باید دوباره خوانده شوند.
// (همان الگوی رویداد مرورگر که برای سبد خرید و ورود/خروج استفاده کرده‌اید.)
export const ADMIN_COUNTS_EVENT = "megabook:admin-counts-changed";
export const notifyCountsChanged = () => window.dispatchEvent(new Event(ADMIN_COUNTS_EVENT));

// ── تکه‌های ظاهری ──

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm text-white shadow-lg ${
        toast.tone === "red" ? "bg-red-600" : "bg-gray-900"
      }`}
    >
      {toast.text}
    </div>
  );
}

export function Cover({ src, className = "h-16 w-11" }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt="" onError={() => setFailed(true)} className={`${className} shrink-0 rounded object-cover ring-1 ring-black/5`} />;
  }
  return (
    <div aria-hidden="true" className={`${className} flex shrink-0 items-center justify-center rounded bg-gradient-to-br from-blue-100 to-blue-200 text-lg`}>
      📘
    </div>
  );
}

export function Badge({ tone = "gray", children }) {
  const cls = {
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    gray: "bg-gray-100 text-gray-600 ring-gray-200",
  }[tone];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cls}`}>{children}</span>;
}

export function CountPill({ n, tone = "blue", label }) {
  if (!n) return null;
  const cls = tone === "blue" ? "bg-blue-600 text-white" : "bg-amber-400 text-gray-900";
  return (
    <span className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold ${cls}`} aria-label={label}>
      {toFaNumber(n)}
    </span>
  );
}

export function SearchBox({ id, value, onChange, placeholder }) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">جستجو</label>
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">🔍</span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-3 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
      />
    </div>
  );
}

export function FilterChips({ options, value, onChange, counts = {}, label = "فیلتر" }) {
  return (
    <div className="flex gap-1 overflow-x-auto" role="group" aria-label={label}>
      {options.map((f) => (
        <button
          key={f.key}
          type="button"
          aria-pressed={value === f.key}
          onClick={() => onChange(f.key)}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
            value === f.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {f.label}
          {counts[f.key] > 0 && (
            <span className={`rounded-full px-1.5 ${value === f.key ? "bg-white/20" : "bg-amber-100 text-amber-800"}`}>{toFaNumber(counts[f.key])}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// فیلد دلیل با هشدار ثابت: «این متن برای کاربر فرستاده می‌شود»
export function ReasonField({ id, label, value, onChange, error, warning = "⚠️ این متن عیناً برای کاربر فرستاده می‌شود.", placeholder, rows = 3 }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint`}
        placeholder={placeholder}
        className={`w-full rounded-xl border p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
          error ? "border-red-400" : "border-gray-300 focus:border-blue-600"
        }`}
      />
      <p id={`${id}-hint`} className={`mt-1 text-xs ${error ? "text-red-600" : "text-amber-700"}`}>
        {error || warning}
      </p>
    </div>
  );
}

// پنجرهٔ تأیید برای کارهای مهم (به‌خصوص کارهای مالی برگشت‌ناپذیر).
// children: خلاصهٔ کاری که انجام می‌شود (مبلغ، نام کاربر، ...)
export function ConfirmDialog({ open, title, children, confirmLabel, tone = "blue", busy, onConfirm, onCancel, confirmDisabled }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus(); // فوکوس پیش‌فرض روی «انصراف»، نه روی کار برگشت‌ناپذیر
    const onKey = (e) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  const btn = tone === "red" ? "bg-red-600 hover:bg-red-700" : tone === "green" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" dir="rtl">
      <div className="absolute inset-0 bg-gray-900/40" onClick={() => !busy && onCancel()} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h2 id="confirm-title" className="text-lg font-bold text-gray-900">{title}</h2>
        <div className="mt-3 space-y-3 text-sm leading-7 text-gray-700">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="h-10 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100">
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-40 ${btn}`}
          >
            {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// اسکلت لیست صف‌ها
export function QueueSkeleton({ rows = 4 }) {
  return (
    <ul className="animate-pulse divide-y divide-gray-100" aria-busy="true" aria-label="در حال بارگذاری">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex gap-3 p-3">
          <div className="h-14 w-10 rounded bg-gray-200" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3.5 w-3/4 rounded bg-gray-200" />
            <div className="h-3 w-1/2 rounded bg-gray-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// چیدمان «صف + جزئیات» که همهٔ بخش‌ها دارند.
// روی دسکتاپ کنار هم؛ روی موبایل یکی در هر لحظه (hasSelection تعیین می‌کند کدام).
export function QueueLayout({ hasSelection, queue, detail, queueWidth = "lg:w-80 xl:w-96" }) {
  return (
    <div className="flex min-h-0 flex-1">
      <section className={`min-h-0 w-full flex-col border-l border-gray-200 bg-white lg:flex lg:shrink-0 ${queueWidth} ${hasSelection ? "hidden" : "flex"}`}>
        {queue}
      </section>
      <section className={`min-h-0 flex-1 flex-col bg-gray-50 lg:flex ${hasSelection ? "flex" : "hidden"}`}>{detail}</section>
    </div>
  );
}

export function EmptyDetail({ text = "یک مورد را از لیست انتخاب کنید." }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-400">{text}</div>;
}

export function BackToQueue({ onClick, label = "برگشت به لیست" }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 lg:hidden">
      → {label}
    </button>
  );
}
