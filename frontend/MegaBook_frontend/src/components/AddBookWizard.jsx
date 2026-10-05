import { useEffect, useRef, useState } from "react";
import { createBook, getCategories } from "../api/catalog";

// فرم چندمرحله‌ای بارگذاری کتاب. فیلدها در ۵ مرحله‌ی مرتبط دسته‌بندی شده‌اند (آرایه‌ی STEPS)
// و نوار بالای فرم نشان می‌دهد کاربر کجاست. داده با buildFormData به شکل multipart
// به POST /catalog/books/ فرستاده می‌شود.

const LANGUAGES = [
  { code: "en", name: "انگلیسی" },
  { code: "fa", name: "فارسی" },
  { code: "ar", name: "عربی" },
  { code: "fr", name: "فرانسوی" },
  { code: "de", name: "آلمانی" },
];

const MAX_COVER_MB = 5;

// اسم کلیدها دقیقاً همان اسم فیلدهای مدل Book است
const EMPTY_FORM = {
  title: "",
  original_title: "",
  isbn: "",
  authors: [],
  translators: [],
  publisher: "",
  category: "",
  tags: [],
  description: "",
  language: "",
  page_count: "",
  publication_year: "",
  edition: "",
  cover: null,
  sample_file: null,
  book_file: null,
  price: "",
};

// هر مرحله فیلدهای مرتبط به هم را دارد. label کوتاه برای نوار مراحل است، title برای عنوان مرحله.
// fields برای دو کار لازم است: اعتبارسنجی همان مرحله، و پیدا کردن مرحله‌ای که خطای سرور در آن است.
const STEPS = [
  { label: "مشخصات", title: "مشخصات کتاب", fields: ["title", "original_title", "authors", "translators"] },
  {
    label: "نشر",
    title: "اطلاعات نشر",
    fields: ["isbn", "edition", "language", "publisher", "page_count", "publication_year"],
  },
  { label: "دسته‌بندی", title: "توضیحات و دسته‌بندی", fields: ["description", "category", "tags"] },
  { label: "فایل‌ها", title: "جلد و فایل‌ها", fields: ["cover", "book_file", "sample_file"] },
  { label: "ارسال", title: "قیمت و ارسال", fields: ["price", "accepted"] },
];

/* ---------- توابع کمکی ---------- */

function toFaNumber(n) {
  return n.toLocaleString("fa-IR");
}

// کیبورد فارسی رقم‌های ۰ تا ۹ را تایپ می‌کند؛ دیتابیس رقم لاتین می‌خواهد
function toLatinDigits(text) {
  return text
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function onlyDigits(text) {
  return toLatinDigits(text).replace(/\D/g, "");
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${kb.toLocaleString("fa-IR")} کیلوبایت`;
}

function isPdf(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isCoverImage(file) {
  return file.type === "image/jpeg" || file.type === "image/png";
}

// همه‌ی خطاهای فرم؛ validateStep فقط خطاهای یک مرحله را از این بیرون می‌کشد
function validateAll(form, accepted) {
  const errors = {};
  if (!form.title.trim()) errors.title = "عنوان کتاب را وارد کنید.";
  if (form.authors.length === 0) errors.authors = "دست‌کم نام یک نویسنده را وارد کنید.";
  if (form.isbn.length !== 13) errors.isbn = "شابک باید ۱۳ رقم باشد.";
  if (!form.language) errors.language = "زبان کتاب را انتخاب کنید.";
  if (form.publication_year && form.publication_year.length !== 4) {
    errors.publication_year = "سال را چهاررقمی وارد کنید.";
  }
  if (!form.cover) errors.cover = "تصویر جلد را انتخاب کنید.";
  if (!form.book_file) errors.book_file = "فایل PDF کتاب را انتخاب کنید.";
  if (form.price === "") errors.price = "قیمت را وارد کنید. برای کتاب رایگان صفر بنویسید.";
  if (!accepted) errors.accepted = "برای ارسال، تایید مالکیت لازم است.";
  return errors;
}

function validateStep(index, form, accepted) {
  const all = validateAll(form, accepted);
  const result = {};
  STEPS[index].fields.forEach((name) => {
    if (all[name]) result[name] = all[name];
  });
  return result;
}

// چون فایل داریم، داده به‌جای JSON در قالب FormData (multipart) فرستاده می‌شود
function buildFormData(form) {
  const data = new FormData();

  data.append("title", form.title.trim());
  data.append("isbn", form.isbn);
  data.append("language", form.language);
  data.append("price", form.price);

  // برای لیست‌ها، یک کلید چند بار تکرار می‌شود
  form.authors.forEach((name) => data.append("authors", name));
  form.translators.forEach((name) => data.append("translators", name));
  form.tags.forEach((name) => data.append("tags", name));

  // فیلدهای اختیاری فقط وقتی فرستاده می‌شوند که پر شده باشند
  const optional = [
    "original_title",
    "publisher",
    "category",
    "description",
    "page_count",
    "publication_year",
    "edition",
  ];
  optional.forEach((name) => {
    const value = String(form[name]).trim();
    if (value) data.append(name, value);
  });

  data.append("cover", form.cover);
  data.append("book_file", form.book_file);
  if (form.sample_file) data.append("sample_file", form.sample_file);

  return data;
}

// خطای DRF به شکل { field: ["پیام"] } است. برای فیلدهای فهرستی گاهی تودرتو می‌آید،
// مثلاً { authors: { 0: ["پیام"] } }؛ اولین متن پیدا شده را برمی‌گرداند.
function firstMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return Object.values(value).map(firstMessage).find(Boolean);
  }
  return undefined;
}

// خطای فیلدهای فرم زیر همان فیلد می‌رود؛ بقیه (detail، non_field_errors، ...) در errors.form
function toFieldErrors(data) {
  const result = {};
  Object.entries(data).forEach(([key, value]) => {
    const message = firstMessage(value);
    if (!message) return;
    if (key in EMPTY_FORM) result[key] = message;
    else result.form = result.form ? `${result.form} ${message}` : message;
  });
  return result;
}

/* ---------- اجزای کوچک ---------- */

function Field({ id, label, optional, hint, error, children }) {
  return (
    <div className="abw-field">
      <label className="abw-label" htmlFor={id}>
        {label}
        {optional && <span className="abw-optional"> (اختیاری)</span>}
      </label>
      {children}
      {hint && !error && <p className="abw-hint">{hint}</p>}
      {error && (
        <p className="abw-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ورودی چندمقداری: برای نویسنده‌ها، مترجم‌ها و برچسب‌ها
function ChipsInput({ id, values, onChange, placeholder, invalid }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const name = draft.trim();
    if (name && !values.includes(name)) onChange([...values, name]);
    setDraft("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === "،") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className={`abw-chips ${invalid ? "abw-invalid" : ""}`}>
      {values.map((value) => (
        <span key={value} className="abw-chip">
          {value}
          <button
            type="button"
            aria-label={`حذف ${value}`}
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    </div>
  );
}

function PdfPicker({ id, file, invalid, onPick }) {
  return (
    <label className={`abw-file ${invalid ? "abw-invalid" : ""}`} htmlFor={id}>
      <span aria-hidden="true">📄</span>
      {file ? (
        <>
          <span className="abw-file-name">{file.name}</span>
          <span className="abw-file-size">{formatSize(file.size)}</span>
        </>
      ) : (
        <span className="abw-file-name abw-file-empty">انتخاب فایل PDF</span>
      )}
      <input id={id} className="abw-sr-input" type="file" accept="application/pdf" onChange={onPick} />
    </label>
  );
}

// نوار مراحل: مرحله‌های قبلی تیک می‌خورند، مرحله‌ی فعلی پررنگ است.
// روی مرحله‌هایی که قبلاً دیده شده‌اند می‌شود زد و مستقیم به آن‌ها رفت.
function StepBar({ current, maxReached, onJump }) {
  const progress = (current / (STEPS.length - 1)) * 100;
  return (
    <nav className="abw-steps" aria-label="مراحل بارگذاری کتاب">
      <div className="abw-track" aria-hidden="true">
        <div className="abw-track-fill" style={{ width: `${progress}%` }} />
      </div>
      <ol>
        {STEPS.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const reachable = index <= maxReached && index !== current;
          return (
            <li key={step.label} className={`abw-step abw-step-${state}`}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={index === current ? "step" : undefined}
                aria-label={`مرحله‌ی ${toFaNumber(index + 1)}: ${step.title}`}
                onClick={() => onJump(index)}
              >
                <span className="abw-step-dot">{state === "done" ? "✓" : toFaNumber(index + 1)}</span>
                <span className="abw-step-label">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------- فرم اصلی ---------- */

export default function AddBookWizard({ onBack }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | submitting | success
  const [step, setStep] = useState(0);
  // دورترین مرحله‌ای که کاربر به آن رسیده؛ تا اینجا را می‌شود از نوار مراحل باز کرد
  const [maxReached, setMaxReached] = useState(0);
  const [coverPreview, setCoverPreview] = useState("");
  const [categories, setCategories] = useState([]);

  const topRef = useRef(null);
  const headingRef = useRef(null);
  // بعد از عوض شدن مرحله، کجا برویم: { field } یعنی اولین فیلد خطادار، {} یعنی عنوان مرحله
  const focusRequest = useRef(null);
  const previewRef = useRef("");

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // آدرس موقت پیش‌نمایش جلد، وقتی کامپوننت بسته شود آزاد می‌شود
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  // وقتی مرحله یا خطاها عوض می‌شوند، فوکوس و اسکرول را به جای درست می‌بریم.
  // این برای کاربر صفحه‌خوان هم مهم است: عنوان مرحله‌ی جدید خوانده می‌شود.
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    if (request.field) {
      document.getElementById(`abw-${request.field}`)?.scrollIntoView({ block: "center" });
    } else {
      headingRef.current?.focus({ preventScroll: true });
      topRef.current?.scrollIntoView({ block: "start" });
    }
  }, [step, errors]);

  const setError = (name, message) => {
    setErrors((prev) => ({ ...prev, [name]: message }));
  };

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(name, undefined);
  };

  const setPreview = (url) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setCoverPreview(url);
  };

  const pickCover = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!isCoverImage(file)) return setError("cover", "تصویر جلد باید JPG یا PNG باشد.");
    if (file.size > MAX_COVER_MB * 1024 * 1024) {
      return setError("cover", "حجم تصویر جلد باید کمتر از ۵ مگابایت باشد.");
    }
    setField("cover", file);
    setPreview(URL.createObjectURL(file));
  };

  const pickPdf = (name) => (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!isPdf(file)) return setError(name, "فقط فایل PDF پذیرفته می‌شود.");
    setField(name, file);
  };

  const handleBack = () => {
    if (onBack) onBack();
    else window.history.back();
  };

  // رفتن به یک مرحله. به عقب همیشه آزاد است؛ به جلو، مرحله‌های بین راه باید درست باشند.
  // اگر یکی ایراد داشت، همان‌جا می‌مانیم و خطاها را نشان می‌دهیم.
  const goTo = (target) => {
    for (let i = step; i < target; i++) {
      const found = validateStep(i, form, accepted);
      const firstInvalid = Object.keys(found)[0];
      if (firstInvalid) {
        focusRequest.current = { field: firstInvalid };
        setErrors((prev) => ({ ...prev, ...found }));
        setStep(i);
        return;
      }
    }
    focusRequest.current = {};
    setStep(target);
    setMaxReached((prev) => Math.max(prev, target));
  };

  const resetAll = () => {
    setForm(EMPTY_FORM);
    setAccepted(false);
    setErrors({});
    setStep(0);
    setMaxReached(0);
    setPreview("");
  };

  const handleSubmit = async () => {
    // همه‌ی مرحله‌ها را دوباره چک می‌کنیم؛ ممکن است کاربر برگشته و چیزی را پاک کرده باشد
    for (let i = 0; i < STEPS.length; i++) {
      const found = validateStep(i, form, accepted);
      const firstInvalid = Object.keys(found)[0];
      if (firstInvalid) {
        focusRequest.current = { field: firstInvalid };
        setErrors((prev) => ({ ...prev, ...found }));
        setStep(i);
        return;
      }
    }

    setStatus("submitting");
    try {
      await createBook(buildFormData(form));
      resetAll();
      setStatus("success");
    } catch (err) {
      const response = err.response;
      if (response?.status === 400 && response.data && typeof response.data === "object") {
        // خطای سرور را زیر فیلدش می‌گذاریم و به اولین مرحله‌ای می‌رویم که خطا دارد
        const serverErrors = toFieldErrors(response.data);
        setErrors(serverErrors);
        const index = STEPS.findIndex((s) => s.fields.some((name) => serverErrors[name]));
        if (index >= 0) {
          focusRequest.current = { field: STEPS[index].fields.find((name) => serverErrors[name]) };
          setStep(index);
        }
      } else if (response?.status === 401) {
        setError("form", "برای بارگذاری کتاب ابتدا وارد شوید.");
      } else {
        setError("form", "ارسال انجام نشد. اتصال اینترنت را بررسی کنید و دوباره بفرستید.");
      }
      setStatus("idle");
    }
  };

  const inputClass = (name, extra = "") =>
    `abw-input ${extra} ${errors[name] ? "abw-invalid" : ""}`;

  const isLast = step === STEPS.length - 1;
  const languageName = LANGUAGES.find((l) => l.code === form.language)?.name;
  const categoryName = categories.find((c) => String(c.id) === String(form.category))?.name;

  // خلاصه‌ی مرحله‌ی آخر: هر ردیف با دکمه‌ی «ویرایش» به مرحله‌ی خودش برمی‌گردد
  const summary = [
    { step: 0, label: "عنوان", value: form.title.trim() },
    { step: 0, label: "نویسنده‌ها", value: form.authors.join("، ") },
    { step: 1, label: "شابک", value: form.isbn, ltr: true },
    { step: 1, label: "زبان", value: languageName },
    { step: 2, label: "موضوع", value: categoryName },
    { step: 3, label: "فایل کتاب", value: form.book_file?.name, ltr: true },
  ];

  return (
    <div className="abw" dir="rtl" ref={topRef}>
      <style>{styles}</style>

      <header className="abw-header">
        <span />
        <h1>بارگذاری کتاب</h1>
        <button type="button" className="abw-back" aria-label="بازگشت" onClick={handleBack}>
          ‹
        </button>
      </header>

      {status === "success" ? (
        <div className="abw-body abw-success">
          <div className="abw-success-icon" aria-hidden="true">
            ✅
          </div>
          <h2>کتاب برای بررسی ارسال شد</h2>
          <p>پس از تایید مدیر، کتاب در فروشگاه نمایش داده می‌شود.</p>
          <button type="button" className="abw-primary" onClick={() => setStatus("idle")}>
            افزودن کتاب دیگر
          </button>
        </div>
      ) : (
        <div className="abw-body">
          <StepBar current={step} maxReached={maxReached} onJump={goTo} />

          <div className="abw-step-head">
            <span className="abw-step-count">
              مرحله‌ی {toFaNumber(step + 1)} از {toFaNumber(STEPS.length)}
            </span>
            <h2 ref={headingRef} tabIndex={-1}>
              {STEPS[step].title}
            </h2>
          </div>

          {/* ---------- ۱. مشخصات کتاب ---------- */}
          {step === 0 && (
            <section className="abw-section">
              <Field id="abw-title" label="عنوان کتاب" error={errors.title}>
                <input
                  id="abw-title"
                  className={inputClass("title")}
                  value={form.title}
                  placeholder="مثلاً: کتابخانه نیمه‌شب"
                  onChange={(e) => setField("title", e.target.value)}
                />
              </Field>

              <Field
                id="abw-original_title"
                label="عنوان در زبان اصلی"
                optional
                hint="فقط برای کتاب ترجمه‌شده"
                error={errors.original_title}
              >
                <input
                  id="abw-original_title"
                  className={inputClass("original_title", "abw-ltr")}
                  value={form.original_title}
                  placeholder="The Midnight Library"
                  onChange={(e) => setField("original_title", e.target.value)}
                />
              </Field>

              <Field id="abw-authors" label="نویسنده‌ها" hint="بعد از هر نام، Enter بزنید." error={errors.authors}>
                <ChipsInput
                  id="abw-authors"
                  values={form.authors}
                  invalid={Boolean(errors.authors)}
                  placeholder="نام نویسنده"
                  onChange={(list) => setField("authors", list)}
                />
              </Field>

              <Field
                id="abw-translators"
                label="مترجم‌ها"
                optional
                hint="بعد از هر نام، Enter بزنید."
                error={errors.translators}
              >
                <ChipsInput
                  id="abw-translators"
                  values={form.translators}
                  invalid={Boolean(errors.translators)}
                  placeholder="نام مترجم"
                  onChange={(list) => setField("translators", list)}
                />
              </Field>
            </section>
          )}

          {/* ---------- ۲. اطلاعات نشر ---------- */}
          {step === 1 && (
            <section className="abw-section">
              <div className="abw-row">
                <Field id="abw-isbn" label="شابک (ISBN-13)" error={errors.isbn}>
                  <input
                    id="abw-isbn"
                    className={inputClass("isbn", "abw-ltr")}
                    inputMode="numeric"
                    value={form.isbn}
                    placeholder="9781234567890"
                    onChange={(e) => setField("isbn", onlyDigits(e.target.value).slice(0, 13))}
                  />
                </Field>

                <Field id="abw-edition" label="ویرایش" optional error={errors.edition}>
                  <input
                    id="abw-edition"
                    className={inputClass("edition")}
                    value={form.edition}
                    placeholder="مثلاً: دوم"
                    onChange={(e) => setField("edition", e.target.value)}
                  />
                </Field>
              </div>

              <div className="abw-row">
                <Field id="abw-language" label="زبان کتاب" error={errors.language}>
                  <select
                    id="abw-language"
                    className={inputClass("language")}
                    value={form.language}
                    onChange={(e) => setField("language", e.target.value)}
                  >
                    <option value="">انتخاب کنید</option>
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field id="abw-publisher" label="ناشر" optional error={errors.publisher}>
                  <input
                    id="abw-publisher"
                    className={inputClass("publisher")}
                    value={form.publisher}
                    placeholder="نام ناشر همین نسخه"
                    onChange={(e) => setField("publisher", e.target.value)}
                  />
                </Field>
              </div>

              <div className="abw-row">
                <Field id="abw-page_count" label="تعداد صفحات" optional error={errors.page_count}>
                  <input
                    id="abw-page_count"
                    className={inputClass("page_count", "abw-ltr")}
                    inputMode="numeric"
                    value={form.page_count}
                    placeholder="342"
                    onChange={(e) => setField("page_count", onlyDigits(e.target.value).slice(0, 5))}
                  />
                </Field>

                <Field id="abw-publication_year" label="سال انتشار" optional error={errors.publication_year}>
                  <input
                    id="abw-publication_year"
                    className={inputClass("publication_year", "abw-ltr")}
                    inputMode="numeric"
                    value={form.publication_year}
                    // placeholder="2023"
                    hint="شمسی یا میلادی، همان‌طور که در شناسنامه‌ی کتاب آمده."
                    onChange={(e) => setField("publication_year", onlyDigits(e.target.value).slice(0, 4))}
                  />
                </Field>
              </div>

              <div className="abw-notice">
                <span aria-hidden="true">⚠️</span>
                <span>شابک باید با شابک روی جلد یکی باشد.</span>
              </div>
            </section>
          )}

          {/* ---------- ۳. توضیحات و دسته‌بندی ---------- */}
          {step === 2 && (
            <section className="abw-section">
              <Field id="abw-description" label="توضیحات کتاب" optional error={errors.description}>
                <textarea
                  id="abw-description"
                  className={inputClass("description", "abw-textarea")}
                  value={form.description}
                  placeholder="خلاصه‌ای کوتاه از محتوای کتاب"
                  onChange={(e) => setField("description", e.target.value)}
                />
              </Field>

              <Field id="abw-category" label="موضوع" optional error={errors.category}>
                <select
                  id="abw-category"
                  className={inputClass("category")}
                  value={form.category}
                  onChange={(e) => setField("category", e.target.value)}
                >
                  <option value="">انتخاب کنید</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="abw-tags" label="برچسب‌ها" optional hint="بعد از هر برچسب، Enter بزنید." error={errors.tags}>
                <ChipsInput
                  id="abw-tags"
                  values={form.tags}
                  invalid={Boolean(errors.tags)}
                  placeholder="مثلاً: فلسفه"
                  onChange={(list) => setField("tags", list)}
                />
              </Field>
            </section>
          )}

          {/* ---------- ۴. جلد و فایل‌ها ---------- */}
          {step === 3 && (
            <section className="abw-section">
              <div className="abw-field">
                <span className="abw-label">تصویر جلد</span>
                <label className={`abw-cover ${errors.cover ? "abw-invalid" : ""}`} htmlFor="abw-cover">
                  {coverPreview ? (
                    <img src={coverPreview} alt="پیش‌نمایش جلد کتاب" />
                  ) : (
                    <>
                      <span className="abw-cover-icon" aria-hidden="true">
                        📷
                      </span>
                      <span className="abw-cover-title">برای انتخاب تصویر جلد ضربه بزنید</span>
                      <span className="abw-cover-sub">JPG یا PNG، حداکثر ۵ مگابایت</span>
                    </>
                  )}
                  <input
                    id="abw-cover"
                    className="abw-sr-input"
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={pickCover}
                  />
                </label>
                {coverPreview && !errors.cover && <p className="abw-hint">برای تغییر تصویر، دوباره روی آن بزنید.</p>}
                {errors.cover && (
                  <p className="abw-error" role="alert">
                    {errors.cover}
                  </p>
                )}
              </div>

              <Field id="abw-book_file" label="فایل کامل کتاب" error={errors.book_file}>
                <PdfPicker
                  id="abw-book_file"
                  file={form.book_file}
                  invalid={Boolean(errors.book_file)}
                  onPick={pickPdf("book_file")}
                />
              </Field>

              <Field
                id="abw-sample_file"
                label="فایل نمونه"
                optional
                hint="چند صفحه از کتاب که خریدار پیش از خرید می‌بیند."
                error={errors.sample_file}
              >
                <PdfPicker
                  id="abw-sample_file"
                  file={form.sample_file}
                  invalid={Boolean(errors.sample_file)}
                  onPick={pickPdf("sample_file")}
                />
              </Field>
            </section>
          )}

          {/* ---------- ۵. قیمت و ارسال ---------- */}
          {step === 4 && (
            <section className="abw-section">
              <div className="abw-card">
                <div className="abw-price-row">
                  <label className="abw-price-label" htmlFor="abw-price">
                    <strong>قیمت فروش</strong>
                    <small>مدیر این مبلغ را بررسی می‌کند</small>
                  </label>
                  <div className={`abw-price-input ${errors.price ? "abw-invalid" : ""}`}>
                    <input
                      id="abw-price"
                      inputMode="numeric"
                      value={form.price}
                      placeholder="0"
                      onChange={(e) => setField("price", onlyDigits(e.target.value).slice(0, 9))}
                    />
                    <span>تومان</span>
                  </div>
                </div>
                {form.price !== "" && !errors.price && (
                  <p className="abw-hint">
                    {Number(form.price) === 0
                      ? "این کتاب رایگان عرضه می‌شود."
                      : `${Number(form.price).toLocaleString("fa-IR")} تومان`}
                  </p>
                )}
                {errors.price && (
                  <p className="abw-error" role="alert">
                    {errors.price}
                  </p>
                )}
              </div>

              <h3 className="abw-subhead">مرور اطلاعات</h3>
              <dl className="abw-summary">
                {summary.map((row) => (
                  <div key={row.label} className="abw-summary-row">
                    <dt>{row.label}</dt>
                    <dd className={row.ltr ? "abw-ltr-text" : ""}>{row.value || "—"}</dd>
                    <button type="button" onClick={() => goTo(row.step)}>
                      ویرایش
                    </button>
                  </div>
                ))}
              </dl>

              <label className="abw-legal" htmlFor="abw-accepted">
                <input
                  id="abw-accepted"
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => {
                    setAccepted(e.target.checked);
                    setError("accepted", undefined);
                  }}
                />
                <span>
                  تایید می‌کنم که مالک قانونی این اثر هستم و حق فروش یا توزیع آن را در مگابوک دارم.
                  <small>اطلاعات نادرست ممکن است به تعلیق حساب منجر شود.</small>
                </span>
              </label>
              {errors.accepted && (
                <p className="abw-error" role="alert">
                  {errors.accepted}
                </p>
              )}

              <div className="abw-info">
                <span aria-hidden="true">ℹ️</span>
                <span>کتاب پس از بررسی مدیر منتشر می‌شود. بررسی معمولاً ۱۲ تا ۲۴ ساعت طول می‌کشد.</span>
              </div>
            </section>
          )}

          {errors.form && (
            <p className="abw-form-error" role="alert">
              {errors.form}
            </p>
          )}

          {/* ---------- دکمه‌های قبلی / بعدی ---------- */}
          <div className="abw-nav">
            {step > 0 && (
              <button type="button" className="abw-secondary" onClick={() => goTo(step - 1)}>
                قبلی
              </button>
            )}
            {isLast ? (
              <button
                type="button"
                className="abw-primary"
                disabled={status === "submitting"}
                onClick={handleSubmit}
              >
                {status === "submitting" ? "در حال ارسال…" : "ارسال برای بررسی"}
              </button>
            ) : (
              <button type="button" className="abw-primary" onClick={() => goTo(step + 1)}>
                بعدی
              </button>
            )}
          </div>

          {isLast && (
            <p className="abw-terms">
              با ارسال، <a href="#">قوانین فروشندگان</a> را می‌پذیرید.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- استایل‌ها ---------- */
// همه‌ی کلاس‌ها با abw- شروع می‌شوند تا با استایل بقیه‌ی برنامه قاطی نشوند

const styles = `
.abw {
  direction: rtl;
  min-height: 100%;
  background: #f4f5f7;
  color: #171a1f;
  font-family: inherit;
  line-height: 1.7;
}
.abw *, .abw *::before, .abw *::after { box-sizing: border-box; }

.abw-header {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #dee1e6;
}
.abw-header h1 { margin: 0; font-size: 20px; font-weight: 700; text-align: center; }
.abw-back {
  width: 44px; height: 44px;
  border: 0; border-radius: 8px;
  background: none; color: inherit;
  font-size: 28px; line-height: 1; cursor: pointer;
}

.abw-body { max-width: 520px; margin: 0 auto; padding: 16px 16px 40px; }

/* نوار مراحل */
.abw-steps { position: relative; margin-top: 4px; }
.abw-steps ol {
  position: relative;
  display: grid; grid-template-columns: repeat(${STEPS.length}, 1fr);
  margin: 0; padding: 0; list-style: none;
}
/* خط پشت دایره‌ها: از وسط دایره‌ی اول تا وسط دایره‌ی آخر */
.abw-track {
  position: absolute; top: 15px; height: 3px;
  inset-inline: calc(100% / ${STEPS.length * 2});
  background: #dee1e6; border-radius: 3px;
}
.abw-track-fill {
  height: 100%; background: #2563eb; border-radius: 3px;
  transition: width 0.25s ease;
}
.abw-step button {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  width: 100%; padding: 0; border: 0; background: none; color: inherit;
  font: inherit; cursor: pointer;
}
.abw-step button:disabled { cursor: default; }
.abw-step-dot {
  display: grid; place-items: center;
  width: 32px; height: 32px; border-radius: 50%;
  background: #fff; border: 2px solid #c9cdd4; color: #6b7280;
  font-size: 14px; font-weight: 700;
}
.abw-step-label { font-size: 12px; color: #6b7280; }
.abw-step-done .abw-step-dot { background: #2563eb; border-color: #2563eb; color: #fff; }
.abw-step-current .abw-step-dot { border-color: #2563eb; color: #2563eb; box-shadow: 0 0 0 4px #dbe6fe; }
.abw-step-current .abw-step-label { color: #171a1f; font-weight: 700; }
.abw-step button:focus-visible .abw-step-dot { outline: 2px solid #2563eb; outline-offset: 2px; }

.abw-step-head { margin-top: 24px; }
.abw-step-count { font-size: 13px; color: #6b7280; }
.abw-step-head h2 { margin: 0; font-size: 20px; font-weight: 700; }
.abw-step-head h2:focus { outline: none; }

.abw-section { margin-top: 16px; }
.abw-subhead { margin: 24px 0 8px; font-size: 16px; font-weight: 700; }

/* جلد */
.abw-cover {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; height: 240px; overflow: hidden;
  background: #e9ebef; border: 1.5px dashed #bcc1ca; border-radius: 12px;
  text-align: center; cursor: pointer;
}
.abw-cover img { width: 100%; height: 100%; object-fit: contain; }
.abw-cover-icon {
  display: grid; place-items: center;
  width: 56px; height: 56px; border-radius: 50%;
  background: #fff; font-size: 24px;
}
.abw-cover-title { font-size: 15px; font-weight: 600; }
.abw-cover-sub { font-size: 13px; color: #6b7280; }

/* فیلدها */
.abw-field { margin-bottom: 16px; }
.abw-label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 600; }
.abw-optional { font-size: 13px; font-weight: 400; color: #6b7280; }
.abw-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.abw-input, .abw-chips, .abw-file {
  width: 100%;
  background: #fff; color: inherit;
  border: 1px solid #c9cdd4; border-radius: 8px;
  font: inherit; font-size: 16px;
}
.abw-input { padding: 10px 14px; }
select.abw-input { height: 49px; }
.abw-textarea { min-height: 110px; resize: vertical; }
.abw-ltr { direction: ltr; text-align: left; }
.abw-input::placeholder, .abw-chips input::placeholder { color: #9aa0aa; }

.abw-input:focus, .abw-chips:focus-within, .abw-file:focus-within,
.abw-cover:focus-within, .abw-price-input:focus-within {
  outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb;
}
.abw-back:focus-visible, .abw-primary:focus-visible, .abw-secondary:focus-visible {
  outline: 2px solid #2563eb; outline-offset: 2px;
}
.abw .abw-invalid { border-color: #d92d20; }

.abw-hint { margin: 6px 0 0; font-size: 13px; color: #6b7280; }
.abw-error { margin: 6px 0 0; font-size: 13px; color: #b42318; }

/* ورودی چندمقداری */
.abw-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 10px; cursor: text; }
.abw-chips input {
  flex: 1; min-width: 110px; padding: 3px 4px;
  border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 16px;
}
.abw-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding-inline: 10px 4px;
  background: #eef3ff; color: #1d4ed8; border-radius: 999px; font-size: 14px;
}
.abw-chip button {
  border: 0; background: none; color: inherit;
  font-size: 18px; line-height: 1; padding: 2px 6px; cursor: pointer;
}

/* انتخاب فایل */
.abw-file {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; cursor: pointer;
}
.abw-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.abw-file-empty { color: #6b7280; }
.abw-file-size { flex-shrink: 0; font-size: 13px; color: #6b7280; }
.abw-sr-input {
  position: absolute; width: 1px; height: 1px;
  opacity: 0; overflow: hidden; clip-path: inset(50%);
}

/* قیمت */
.abw-card { background: #fff; border: 1px solid #dee1e6; border-radius: 12px; padding: 16px; }
.abw-price-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.abw-price-label strong { display: block; font-size: 15px; }
.abw-price-label small { font-size: 13px; color: #6b7280; }
.abw-price-input {
  display: flex; align-items: center; gap: 6px;
  width: 170px; flex-shrink: 0; padding: 0 12px;
  background: #fff; border: 1px solid #c9cdd4; border-radius: 8px;
}
.abw-price-input input {
  width: 100%; padding: 9px 0;
  border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 17px; font-weight: 700;
  direction: ltr; text-align: left;
}
.abw-price-input span { font-size: 13px; color: #6b7280; }
.abw-info {
  display: flex; gap: 10px; margin-top: 16px; padding: 10px 12px;
  background: #eef3ff; border: 1px solid #c3d4fb; border-radius: 8px;
  font-size: 14px; color: #1e3a8a;
}
.abw-notice {
  display: flex; gap: 10px; margin-top: 4px; padding: 12px 14px;
  background: #fff; border: 1px solid #dee1e6; border-radius: 10px; font-size: 14px;
}

/* مرور اطلاعات */
.abw-summary {
  margin: 0; background: #fff; border: 1px solid #dee1e6; border-radius: 12px;
  padding: 4px 14px;
}
.abw-summary-row {
  display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid #eceef1;
}
.abw-summary-row:last-child { border-bottom: 0; }
.abw-summary dt { font-size: 13px; color: #6b7280; }
.abw-summary dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.abw-ltr-text { direction: ltr; text-align: right; }
.abw-summary button {
  border: 0; background: none; color: #2563eb;
  font: inherit; font-size: 13px; cursor: pointer; padding: 4px;
}

/* تایید مالکیت */
.abw-legal {
  display: flex; align-items: flex-start; gap: 12px; margin-top: 16px;
  padding: 14px; background: #eceef1; border-radius: 8px;
  font-size: 15px; cursor: pointer;
}
.abw-legal input { width: 20px; height: 20px; margin-top: 4px; flex-shrink: 0; accent-color: #2563eb; }
.abw-legal small { display: block; margin-top: 4px; font-size: 13px; color: #6b7280; }

/* ناوبری و ارسال */
.abw-form-error {
  margin: 20px 0 0; padding: 10px 12px;
  background: #fef3f2; border: 1px solid #fda29b; border-radius: 8px;
  font-size: 14px; color: #b42318;
}
.abw-nav { display: flex; gap: 12px; margin-top: 24px; }
.abw-primary, .abw-secondary {
  flex: 1; height: 52px;
  border-radius: 10px;
  font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
}
.abw-primary { border: 0; background: #2563eb; color: #fff; }
.abw-primary:hover { background: #1d4fd7; }
.abw-primary:disabled { background: #9db7f5; cursor: default; }
.abw-secondary { flex: 0 0 35%; border: 1px solid #c9cdd4; background: #fff; color: inherit; }
.abw-secondary:hover { background: #f4f5f7; }
.abw-terms { margin: 12px 0 0; text-align: center; font-size: 13px; color: #6b7280; }
.abw-terms a { color: #2563eb; }

/* پیام موفقیت */
.abw-success { padding-top: 56px; text-align: center; }
.abw-success-icon { font-size: 48px; }
.abw-success h2 { margin: 12px 0 4px; font-size: 20px; }
.abw-success p { margin: 0 0 24px; color: #6b7280; }
.abw-success .abw-primary { width: 100%; }
`;
