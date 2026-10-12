import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { lookupIsbn } from "../api/catalog";
import { createBookRequest } from "../api/bookRequests";

// ═════════════════════════════════════════════════════════════
// درخواست کتاب بر اساس شابک
//   مرحله ۱: کاربر شابک را وارد می‌کند و «جستجوی کتاب» را می‌زند
//   مرحله ۲: نتیجه‌ی GET /catalog/isbn-lookup/ (یا ورود دستی اگر پیدا نشد)
//   مرحله ۳: توضیحات، فقط بعد از اینکه کتاب مشخص شد
//
// جست‌وجو از طریق بک‌اند انجام می‌شود، نه مستقیم از Open Library، چون بک‌اند
// هم دیتابیس خودمان را می‌گردد (already_exists) و هم اگر منبع اطلاعات عوض شد،
// فرانت دست نمی‌خورد.
// ═════════════════════════════════════════════════════════════

// ── ابزارهای شابک ──
// اینجا فقط می‌پرسیم «آیا ورودی شبیه شابک است؟» تا دکمه فعال شود.
// رقم کنترلی و تبدیل ISBN-10 کار بک‌اند است (catalog/isbn.py) و خطایش با 400 برمی‌گردد؛
// این قاعده را در فرانت تکرار نمی‌کنیم تا دو نسخه‌ی متفاوت از آن نداشته باشیم.
function cleanIsbn(raw) {
  return raw
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\s\-‐-―]/g, "")
    .toUpperCase();
}

// ۱۳ رقم، یا ۱۰ کاراکتر که آخری می‌تواند X باشد (ISBN-10)
function looksLikeIsbn(raw) {
  const value = cleanIsbn(raw);
  return /^\d{13}$/.test(value) || /^\d{9}[\dX]$/.test(value);
}

// شابک ۱۳ رقمی برای نمایش: تقسیم دقیقش به ناشر بستگی دارد، پس فقط پیشوند را جدا می‌کنیم
const displayIsbn = (isbn) => `${isbn.slice(0, 3)}-${isbn.slice(3)}`;

// «علی، رضا, مریم» -> ["علی", "رضا", "مریم"]
function splitNames(text) {
  return text
    .split(/[,،]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

const NOTE_MAX = 500;
const EMPTY_MANUAL = { title: "", authors: "" };

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function RequestByIsbnPage({ onBack }) {
  const [isbnInput, setIsbnInput] = useState("");
  const [isbnError, setIsbnError] = useState(""); // پیام 400 بک‌اند، زیر input

  // وضعیت جستجو:
  //   idle      هنوز جستجو نشده (یا شابک بعد از جستجو عوض شده)
  //   loading   منتظر جواب بک‌اند
  //   found     200: کتاب در Open Library پیدا شد
  //   fallback  404 یا 502: پیدا نشد یا منبع در دسترس نبود؛ کاربر دستی وارد می‌کند
  //   error     جواب نیامد (بک‌اند خاموش، قطع شبکه) یا خطای دیگر
  const [lookupStatus, setLookupStatus] = useState("idle");
  // در found: جواب کامل API. در fallback: { isbn, already_exists, message, httpStatus }
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // ورود دستی عنوان و نویسنده، وقتی جستجو اطلاعات کامل نداد
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [notes, setNotes] = useState("");

  // ── ثبت درخواست ──
  const [submitting, setSubmitting] = useState(false);
  // خطای فیلدها از 400 بک‌اند: { title, authors, notes }
  const [fieldErrors, setFieldErrors] = useState({});
  // پیام کنار دکمه‌ی ثبت: 409 (تکراری / رد شده / موجود) یا خطای کلی
  //   { tone, icon, message, reason?, bookId? }
  const [submitNotice, setSubmitNotice] = useState(null);
  // پیام موفقیت بالای صفحه، بعد از اینکه صفحه برای درخواست بعدی خالی شد: { message, title }
  const [success, setSuccess] = useState(null);

  // شماره‌ی آخرین جستجو. جوابی که شماره‌اش با این یکی نباشد، مال شابک قبلی است و دور ریخته می‌شود.
  const latestLookup = useRef(0);
  const step2Ref = useRef(null);

  // ── مشتقات (derived state): از stateهای بالا حساب می‌شوند، نه state جدا ──
  const canLookup = looksLikeIsbn(isbnInput) && lookupStatus !== "loading";
  const alreadyExists = Boolean(result?.already_exists);
  // پیدا شد، ولی Open Library عنوان یا نویسنده نداد؛ کاربر باید کاملش کند
  const foundIncomplete =
    lookupStatus === "found" && (!result.title || result.authors.length === 0);
  const showManual = !alreadyExists && (lookupStatus === "fallback" || foundIncomplete);
  const manualComplete = Boolean(manual.title.trim() && manual.authors.trim());
  // «کتاب تأییدشده» = با جستجو کامل پیدا شد، یا دستی کامل وارد شد. فقط آن وقت مرحله ۳ باز است.
  const bookVerified =
    !alreadyExists &&
    ((lookupStatus === "found" && !foundIncomplete) || (showManual && manualComplete));

  function scrollToStep2() {
    // روی موبایل، کاربر را به نتیجه می‌بریم
    requestAnimationFrame(() =>
      step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  // هر چه به کتاب فعلی مربوط است پاک می‌شود و جستجوی در راه هم بی‌اثر می‌شود
  // تا جوابش روی کتاب بعدی ننشیند
  function clearBook() {
    latestLookup.current += 1;
    setIsbnError("");
    setLookupStatus("idle");
    setResult(null);
    setManual(EMPTY_MANUAL);
    setNotes("");
    setFieldErrors({});
    setSubmitNotice(null);
  }

  function handleIsbnChange(e) {
    // شابک عوض شد: هر چه به شابک قبلی مربوط بود دیگر معتبر نیست
    setIsbnInput(e.target.value);
    clearBook();
    setSuccess(null);
  }

  async function handleLookup(e) {
    e.preventDefault();
    if (!canLookup) return;

    const lookupId = ++latestLookup.current;
    setIsbnError("");
    setResult(null);
    setFieldErrors({});
    setSubmitNotice(null);
    setSuccess(null);
    setLookupStatus("loading");

    try {
      // ورودی خام را می‌فرستیم؛ بک‌اند خط تیره، رقم فارسی و ISBN-10 را خودش درست می‌کند
      const data = await lookupIsbn(isbnInput.trim());
      if (lookupId !== latestLookup.current) return; // در این فاصله شابک عوض شده
      setResult(data);
      // اگر چیزی کم بود، فیلدهای دستی با همان مقدارهای موجود پر می‌شوند
      setManual({ title: data.title ?? "", authors: data.authors.join("، ") });
      setLookupStatus("found");
      scrollToStep2();
    } catch (err) {
      if (lookupId !== latestLookup.current) return;
      const status = err.response?.status;
      const data = err.response?.data;

      if (status === 400 && data?.isbn) {
        // شابک نامعتبر: پیام زیر input، مرحله ۲ همان حالت خالی
        setIsbnError(data.isbn[0]);
        setLookupStatus("idle");
      } else if ((status === 404 || status === 502) && data?.detail) {
        // پیدا نشد / منبع در دسترس نبود: پیام API و ورود دستی
        setResult({
          isbn: data.isbn,
          already_exists: data.already_exists,
          message: data.detail,
          httpStatus: status,
        });
        setManual(EMPTY_MANUAL);
        setLookupStatus("fallback");
        scrollToStep2();
      } else {
        setErrorMessage(
          status === 401
            ? "برای جستجو ابتدا وارد حساب کاربری شوید."
            : "ارتباط با سرور برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید."
        );
        setLookupStatus("error");
      }
    }
  }

  function handleManualChange(e) {
    const { name, value } = e.target;
    setManual((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    setSubmitNotice(null);
  }

  async function handleSubmit() {
    if (!bookVerified || submitting) return;

    // عنوان و نویسنده یا از نتیجه‌ی جستجوست، یا (وقتی پیدا نشد یا ناقص بود) از فیلدهای دستی
    const fromLookup = lookupStatus === "found" && !foundIncomplete;
    const payload = {
      isbn: result.isbn, // همیشه ۱۳ رقمیِ تبدیل‌شده توسط بک‌اند
      title: fromLookup ? result.title : manual.title.trim(),
      // در بک‌اند متن ساده است، نه فهرست
      authors: (fromLookup ? result.authors : splitNames(manual.authors)).join("، "),
      cover_url: lookupStatus === "found" ? result.cover_url ?? "" : "",
      notes: notes.trim(),
    };

    setSubmitting(true);
    setFieldErrors({});
    setSubmitNotice(null);
    try {
      const data = await createBookRequest(payload);
      // ثبت شد: صفحه برای درخواست بعدی خالی می‌شود و پیام موفقیت بالای صفحه می‌ماند
      setIsbnInput("");
      clearBook();
      setSuccess({ message: data.message, title: payload.title });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;

      if (status === 409 && data?.result === "already_requested") {
        setSubmitNotice({ tone: "amber", icon: "📌", message: data.message });
      } else if (status === 409 && data?.result === "rejected") {
        setSubmitNotice({ tone: "red", icon: "⛔", message: data.message, reason: data.rejection_reason });
      } else if (status === 409 && data?.result === "available") {
        setSubmitNotice({ tone: "green", icon: "📗", message: data.message, bookId: data.book_id });
      } else if (status === 400 && data && typeof data === "object") {
        // خطای هر فیلد کنار همان فیلد؛ اگر فیلدش روی صفحه نیست (مثلاً عنوان از جستجو آمده)، پیام کلی
        const next = {};
        const general = [];
        Object.entries(data).forEach(([field, messages]) => {
          const message = Array.isArray(messages) ? messages[0] : String(messages);
          if (field === "isbn") setIsbnError(message);
          else if (field === "notes") next.notes = message;
          else if ((field === "title" || field === "authors") && showManual) next[field] = message;
          else general.push(message);
        });
        setFieldErrors(next);
        if (general.length) setSubmitNotice({ tone: "red", icon: "⚠️", message: general.join(" ") });
      } else {
        setSubmitNotice({
          tone: "red",
          icon: "⚠️",
          message:
            status === 401
              ? "برای ثبت درخواست ابتدا وارد حساب کاربری شوید."
              : "ثبت درخواست انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell onBack={onBack}>
      <p className="px-5 pt-5 text-sm leading-7 text-gray-500">
        کتابی را که در فروشگاه پیدا نمی‌کنید با شابک درخواست دهید. وقتی کسی آن را
        بارگذاری کند، به شما خبر می‌دهیم.
      </p>

      {/* بعد از ثبت موفق صفحه خالی شده؛ این پیام تا شروع درخواست بعدی می‌ماند */}
      {success && (
        <div className="mx-4 mt-4">
          <Notice tone="green" icon="✅">
            <p className="font-semibold">{success.message}</p>
            <p dir="auto">«{success.title}»</p>
          </Notice>
        </div>
      )}

      {/* ═══ مرحله ۱: شناسایی کتاب ═══ */}
      <Step
        number={1}
        title="شابک کتاب را وارد کنید"
        state={lookupStatus === "found" || lookupStatus === "fallback" ? "done" : "active"}
      >
        <form onSubmit={handleLookup} noValidate>
          <label htmlFor="isbn" className="mb-1.5 block text-sm text-gray-600">
            شابک ۱۰ یا ۱۳ رقمی، معمولاً پشت جلد یا صفحه شناسنامه کتاب
          </label>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
              ▥
            </span>
            <input
              id="isbn"
              type="text"
              dir="ltr"
              inputMode="numeric" // کیبورد عددی در موبایل
              autoComplete="off"
              value={isbnInput}
              onChange={handleIsbnChange}
              disabled={submitting} // تا جواب ثبت نیامده، شابک عوض نشود
              aria-invalid={Boolean(isbnError)}
              aria-describedby={isbnError ? "isbn-error" : undefined}
              placeholder="978-600-229-655-9"
              className={`h-12 w-full rounded-xl border bg-white pl-11 pr-4 text-left font-mono tracking-wider text-gray-900 placeholder:font-sans placeholder:tracking-normal placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                isbnError ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-blue-600"
              }`}
            />
          </div>
          {isbnError && (
            <p id="isbn-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {isbnError}
            </p>
          )}

          <button
            type="submit"
            disabled={!canLookup}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
          >
            {lookupStatus === "loading" ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                در حال جستجو…
              </>
            ) : (
              <>
                <span aria-hidden="true">🔍</span>
                جستجوی کتاب
              </>
            )}
          </button>
        </form>
      </Step>

      {/* ═══ مرحله ۲: بررسی اطلاعات ═══ */}
      <div ref={step2Ref} className="scroll-mt-16">
        <Step
          number={2}
          title="اطلاعات کتاب را بررسی کنید"
          state={lookupStatus === "idle" ? "locked" : bookVerified ? "done" : "active"}
        >
          {lookupStatus === "idle" && (
            <EmptyHint text="بعد از جستجوی شابک، عنوان، نویسنده و جلد کتاب اینجا نمایش داده می‌شود." />
          )}

          {lookupStatus === "loading" && <PreviewSkeleton />}

          {lookupStatus === "error" && (
            <Notice tone="red" icon="⚠️">
              {errorMessage}
            </Notice>
          )}

          <div className="space-y-4">
            {/* کتاب در دیتابیس ما هست (در هر وضعیتی) ← درخواست جدید لازم نیست */}
            {alreadyExists && (
              <Notice tone="green" icon="📗">
                <p className="font-semibold">این کتاب در مگابوک ثبت شده است</p>
              </Notice>
            )}

            {lookupStatus === "found" && <MetadataCard book={result} />}

            {/* 404 یا 502: همان پیام فارسی بک‌اند */}
            {lookupStatus === "fallback" && !alreadyExists && (
              <Notice tone={result.httpStatus === 502 ? "amber" : "blue"} icon={result.httpStatus === 502 ? "⚠️" : "ℹ️"}>
                {result.message}
                <span className="mt-1 block text-xs">
                  شابک: <span dir="ltr" className="font-mono">{displayIsbn(result.isbn)}</span>
                </span>
              </Notice>
            )}

            {foundIncomplete && !alreadyExists && (
              <Notice tone="blue" icon="ℹ️">
                بخشی از اطلاعات این کتاب پیدا نشد. عنوان و نویسنده را کامل کنید.
              </Notice>
            )}

            {showManual && (
              <>
                <Field
                  id="title"
                  label="عنوان کتاب"
                  value={manual.title}
                  onChange={handleManualChange}
                  error={fieldErrors.title}
                  disabled={submitting}
                  placeholder="مثلاً: سووشون"
                />
                <Field
                  id="authors"
                  label="نویسنده"
                  value={manual.authors}
                  onChange={handleManualChange}
                  error={fieldErrors.authors}
                  disabled={submitting}
                  placeholder="اگر چند نفرند، با ویرگول جدا کنید"
                />
              </>
            )}
          </div>
        </Step>
      </div>

      {/* ═══ مرحله ۳: توضیحات ═══ */}
      <Step number={3} title="توضیحات (اختیاری)" state={bookVerified ? "active" : "locked"}>
        <label htmlFor="notes" className="sr-only">
          توضیحات درخواست
        </label>
        <textarea
          id="notes"
          rows={4}
          maxLength={NOTE_MAX}
          disabled={!bookVerified || submitting}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setFieldErrors((prev) => ({ ...prev, notes: undefined }));
            setSubmitNotice(null);
          }}
          aria-invalid={Boolean(fieldErrors.notes)}
          aria-describedby={fieldErrors.notes ? "notes-error" : undefined}
          placeholder="مثلاً: ترجمه یک مترجم خاص، چاپ قدیمی، یا برای استفاده درسی"
          className="w-full resize-none rounded-xl border border-gray-300 bg-white p-4 text-sm leading-7 text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-gray-50"
        />
        <div className="mt-1 flex justify-between text-xs text-gray-400">
          {/* راهنما فقط تا وقتی توضیحات قفل است */}
          <span>{bookVerified ? "" : "اول کتاب را با شابک پیدا کنید."}</span>
          <span>
            {notes.length.toLocaleString("fa-IR")} / {NOTE_MAX.toLocaleString("fa-IR")}
          </span>
        </div>
        {fieldErrors.notes && (
          <p id="notes-error" role="alert" className="mt-1.5 text-xs text-red-600">
            {fieldErrors.notes}
          </p>
        )}
      </Step>

      {/* ═══ ثبت ═══ */}
      <div className="mx-4 mt-2">
        {/* 409 (تکراری / رد شده / موجود در فروشگاه) یا خطای کلی */}
        {submitNotice && (
          <div className="mb-3">
            <Notice tone={submitNotice.tone} icon={submitNotice.icon}>
              <p className="font-semibold">{submitNotice.message}</p>
              {submitNotice.reason && <p className="mt-1">دلیل: {submitNotice.reason}</p>}
              {/* نتیجه‌ی available شناسه‌ی کتاب را دارد؛ به صفحه‌ی همان کتاب می‌رویم */}
              {submitNotice.bookId && (
                <Link
                  to={`/books/${submitNotice.bookId}`}
                  className="mt-2 inline-block font-semibold underline underline-offset-4"
                >
                  رفتن به صفحه‌ی کتاب
                </Link>
              )}
            </Notice>
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!bookVerified || submitting}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
        >
          {submitting && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {submitting ? "در حال ثبت…" : "ثبت درخواست"}
        </button>

        <p className="mt-3 flex items-start gap-2 text-xs leading-6 text-gray-500">
          <span aria-hidden="true">⏱️</span>
          درخواست‌ها معمولاً ظرف ۲۴ تا ۴۸ ساعت کاری توسط مدیر بررسی می‌شوند.
        </p>
      </div>
    </PageShell>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی. فقط در همین صفحه استفاده می‌شوند،
// برای همین در همین فایل مانده‌اند.
// ═════════════════════════════════════════════════════════════

// onBack از router می‌آید (App.jsx)، مثل فرم بارگذاری کتاب
function PageShell({ onBack, children }) {
  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <button
            type="button"
            onClick={onBack}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="text-base font-bold text-gray-900">درخواست بر اساس شابک</h1>
          {/* جای خالی هم‌اندازه‌ی دکمه‌ی برگشت، تا عنوان وسط بماند */}
          <span className="h-10 w-10" aria-hidden="true" />
        </header>
        {children}
      </div>
    </div>
  );
}

// هر مرحله سه حالت دارد: active (در حال انجام)، done (انجام شده)، locked (هنوز باز نشده)
function Step({ number, title, state, children }) {
  const badge = {
    active: "bg-blue-600 text-white",
    done: "bg-green-600 text-white",
    locked: "bg-gray-200 text-gray-500",
  }[state];

  return (
    <section
      className={`mx-4 mt-4 rounded-2xl border bg-white p-4 shadow-sm transition-opacity ${
        state === "locked" ? "border-gray-200 opacity-60" : "border-gray-200"
      }`}
    >
      <h2 className="mb-3 flex items-center gap-3 text-base font-bold text-gray-900">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${badge}`}>
          {state === "done" ? "✓" : number.toLocaleString("fa-IR")}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// book همان جواب 200 بک‌اند است. هر مقدار null نمایش داده نمی‌شود.
function MetadataCard({ book }) {
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <div className="flex gap-4 rounded-xl bg-gray-50 p-3">
      {book.cover_url && !coverFailed ? (
        <img
          src={book.cover_url}
          alt={book.title ? `جلد ${book.title}` : "جلد کتاب"}
          onError={() => setCoverFailed(true)} // Open Library گاهی آدرس جلد دارد ولی تصویرش نیست
          className="h-28 w-20 shrink-0 rounded-md object-cover shadow-md ring-1 ring-black/5"
        />
      ) : (
        <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md bg-blue-100 text-2xl">
          📘
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* عنوان و نویسنده ممکن است انگلیسی باشند؛ dir="auto" جهت را از خود متن تشخیص می‌دهد */}
        {book.title && <p dir="auto" className="font-bold leading-snug text-gray-900">{book.title}</p>}
        {book.authors.length > 0 && (
          <p dir="auto" className="mt-1 text-sm text-gray-600">{book.authors.join("، ")}</p>
        )}
        <dl className="mt-2 space-y-0.5 text-xs text-gray-500">
          {book.publisher && (
            <div className="flex gap-1">
              <dt>ناشر:</dt>
              <dd dir="auto">{book.publisher}</dd>
            </div>
          )}
          {book.publication_year && (
            <div className="flex gap-1">
              <dt>سال:</dt>
              {/* بدون جداکننده‌ی هزارگان: ۱۹۸۹ نه ۱٬۹۸۹ */}
              <dd>{book.publication_year.toLocaleString("fa-IR", { useGrouping: false })}</dd>
            </div>
          )}
          {book.page_count && (
            <div className="flex gap-1">
              <dt>تعداد صفحات:</dt>
              <dd>{book.page_count.toLocaleString("fa-IR")}</dd>
            </div>
          )}
          <div className="flex gap-1">
            <dt>شابک:</dt>
            <dd dir="ltr" className="font-mono">{displayIsbn(book.isbn)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex animate-pulse gap-4 rounded-xl bg-gray-50 p-3" aria-busy="true">
      <div className="h-28 w-20 rounded-md bg-gray-200" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-4 w-3/4 rounded bg-gray-200" />
        <div className="h-3 w-1/2 rounded bg-gray-200" />
        <div className="h-3 w-2/3 rounded bg-gray-200" />
      </div>
    </div>
  );
}

function EmptyHint({ text }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 px-6 py-8 text-center">
      <span className="text-3xl" aria-hidden="true">📚</span>
      <p className="mt-2 text-sm leading-6 text-gray-500">{text}</p>
    </div>
  );
}

function Notice({ tone, icon, children }) {
  const styles = {
    red: "border-red-200 bg-red-50 text-red-700",
    green: "border-green-200 bg-green-50 text-green-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border p-3 text-sm leading-6 ${styles}`}>
      <span aria-hidden="true">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Field({ id, label, value, onChange, error, placeholder, disabled = false }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        dir="auto"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`h-12 w-full rounded-xl border bg-white px-4 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
          error ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-blue-600"
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
