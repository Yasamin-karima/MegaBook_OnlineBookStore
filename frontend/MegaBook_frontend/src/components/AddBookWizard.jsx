import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "../api/auth";
import { createBook, getCategories, lookupIsbn } from "../api/catalog";
import { LANGUAGES, formatFileSize, languageName, toFaNumber, toFaYear } from "../utils/format";

// فرم چندمرحله‌ای بارگذاری کتاب. فیلدها در ۶ مرحله‌ی مرتبط دسته‌بندی شده‌اند (آرایه‌ی STEPS)
// و نوار بالای فرم نشان می‌دهد کاربر کجاست. داده با buildFormData به شکل multipart
// به POST /catalog/books/ فرستاده می‌شود.
//
// مرحله‌ی اول شابک است: کاربر می‌تواند با «دریافت اطلاعات» مشخصات را از Open Library
// (از طریق GET /catalog/isbn-lookup/) بگیرد تا فیلدهای خالی پر شوند، و بعد در مرحله‌های
// بعدی همه را بررسی و اصلاح کند. دریافت اطلاعات اختیاری است؛ فرم دستی هم کامل کار می‌کند.

// پیام «این شابک در مگابوک هست» بر اساس وضعیت کتاب موجود (existing_status جواب جستجو).
// کتاب «رد شده» در جواب جستجو حساب نمی‌شود (already_exists=false) و دوباره قابل بارگذاری است.
const ISBN_TAKEN = "این کتاب قبلاً در مگابوک ثبت شده است";
const ISBN_IN_REVIEW = "این کتاب بارگذاری شده و در انتظار بررسی است";

function takenMessage(data) {
  return data.existing_status === "pending" ? ISBN_IN_REVIEW : ISBN_TAKEN;
}

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
  // آدرس جلدی که Open Library پیدا کرد؛ فقط وقتی فرستاده می‌شود که کاربر فایل جلد نداشته باشد
  cover_url: "",
  sample_file: null,
  book_file: null,
  // The money field (step 6). Only one is used, depending on who uploads (moneyFieldFor):
  // seller_share for regular users, price for admins. Both are here so server errors
  // under either name land under the field.
  seller_share: "",
  price: "",
};

// Regular user: the amount they want per sale (seller_share); the store price is set
// by MegaBook on approval. Admin: the store price itself; their books need no review and
// the whole price goes to MegaBook (the backend sets seller_share to 0).
function moneyFieldFor(isStaff) {
  return isStaff ? "price" : "seller_share";
}

// هر مرحله فیلدهای مرتبط به هم را دارد. label کوتاه برای نوار مراحل است، title برای عنوان مرحله.
// fields برای دو کار لازم است: اعتبارسنجی همان مرحله، و پیدا کردن مرحله‌ای که خطای سرور در آن است.
const STEPS = [
  { label: "شابک", title: "شابک کتاب", fields: ["isbn"] },
  { label: "مشخصات", title: "مشخصات کتاب", fields: ["title", "original_title", "authors", "translators"] },
  {
    label: "نشر",
    title: "اطلاعات نشر",
    fields: ["edition", "language", "publisher", "page_count", "publication_year"],
  },
  { label: "دسته‌بندی", title: "توضیحات و دسته‌بندی", fields: ["description", "category", "tags"] },
  { label: "فایل‌ها", title: "جلد و فایل‌ها", fields: ["cover", "book_file", "sample_file"] },
  { label: "ارسال", title: "مبلغ و ارسال", fields: ["seller_share", "price", "accepted"] },
];

/* ---------- توابع کمکی ---------- */
// قالب‌بندی عدد، سال، حجم فایل و نام زبان در src/utils/format.js است (مشترک با بقیه‌ی صفحه‌ها)

// کیبورد فارسی رقم‌های ۰ تا ۹ را تایپ می‌کند؛ دیتابیس رقم لاتین می‌خواهد
function toLatinDigits(text) {
  return text
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function onlyDigits(text) {
  return toLatinDigits(text).replace(/\D/g, "");
}

function isPdf(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isCoverImage(file) {
  return file.type === "image/jpeg" || file.type === "image/png";
}

// همه‌ی خطاهای فرم؛ validateStep فقط خطاهای یک مرحله را از این بیرون می‌کشد
// isbnTaken: پیام «این کتاب در مگابوک هست» (یا رشته‌ی خالی)؛ تا شابک عوض نشود، نمی‌شود جلو رفت
// (سرور هم شابک تکراری را رد می‌کند، بهتر است کاربر همین اول بفهمد نه بعد از پنج مرحله)
function validateAll(form, accepted, isbnTaken = "", moneyField = "seller_share") {
  const errors = {};
  if (!form.title.trim()) errors.title = "عنوان کتاب را وارد کنید.";
  if (form.authors.length === 0) errors.authors = "دست‌کم نام یک نویسنده را وارد کنید.";
  if (form.isbn.length !== 13) errors.isbn = "شابک باید ۱۳ رقم باشد.";
  else if (isbnTaken) errors.isbn = isbnTaken;
  if (!form.language) errors.language = "زبان کتاب را انتخاب کنید.";
  if (form.publication_year && form.publication_year.length !== 4) {
    errors.publication_year = "سال را چهاررقمی وارد کنید.";
  }
  // جلد: یا فایل خود کاربر، یا جلدی که Open Library پیدا کرد
  if (!form.cover && !form.cover_url) errors.cover = "تصویر جلد را انتخاب کنید.";
  if (!form.book_file) errors.book_file = "فایل PDF کتاب را انتخاب کنید.";
  if (form[moneyField] === "") {
    errors[moneyField] =
      moneyField === "price"
        ? "قیمت فروش را وارد کنید. برای کتاب رایگان صفر بنویسید."
        : "مبلغی را که برای هر فروش می‌خواهید دریافت کنید وارد کنید. اگر پولی نمی‌خواهید، صفر بنویسید.";
  }
  if (!accepted) errors.accepted = "برای ارسال، تایید مالکیت لازم است.";
  return errors;
}

function validateStep(index, form, accepted, isbnTaken = "", moneyField = "seller_share") {
  const all = validateAll(form, accepted, isbnTaken, moneyField);
  const result = {};
  STEPS[index].fields.forEach((name) => {
    if (all[name]) result[name] = all[name];
  });
  return result;
}

// نام فارسی فیلدها برای پیام «این‌ها پر شدند»
const FIELD_NAMES = {
  title: "عنوان",
  authors: "نویسنده‌ها",
  publisher: "ناشر",
  page_count: "تعداد صفحات",
  publication_year: "سال انتشار",
  cover_url: "جلد",
};

// سال انتشار پر می‌شود ولی قفل نمی‌شود: Open Library معمولاً سال میلادی دارد و کتاب فارسی
// باید سال شمسیِ چاپ‌شده در کتاب را داشته باشد (DECISIONS ۳.۳)، پس کاربر باید بتواند اصلاحش کند.
const EDITABLE_LOOKUP_FIELDS = ["publication_year"];

const LOCKED_HINT =
  "از Open Library آمده و قابل تغییر نیست. اگر نادرست است، در مرحله‌ی «شابک» گزینه‌ی «اطلاعات درست نیست» را بزنید.";

// جواب جستجو را به شکل مقدارهای فرم درمی‌آورد؛ فقط فیلدهایی که Open Library واقعاً داده.
// فیلدی که اینجا نیست (null در جواب) قفل نمی‌شود و کاربر خودش پرش می‌کند.
// جلد، برچسب، دسته‌بندی، زبان و توضیحات عمداً اینجا نیستند.
function lookupValues(data) {
  const values = {};
  if (data.title) values.title = data.title;
  if (data.authors?.length > 0) values.authors = data.authors;
  if (data.publisher) values.publisher = data.publisher;
  // همان محدودیت طولی که inputها دارند
  if (data.page_count) values.page_count = String(data.page_count).slice(0, 5);
  if (data.publication_year) values.publication_year = String(data.publication_year).slice(0, 4);
  // جلد: بک‌اند هنگام ارسال آن را از Open Library دانلود می‌کند (اگر کاربر فایل خودش را نگذارد)
  if (data.cover_url) values.cover_url = data.cover_url;
  return values;
}

// داده‌ی دریافت‌شده را از فرم برمی‌دارد (وقتی شابک عوض می‌شود یا کاربر «اطلاعات درست نیست» می‌زند).
// فیلدهای قفل همیشه خالی می‌شوند؛ سال (تنها فیلد دریافتیِ قابل ویرایش) فقط اگر کاربر عوضش نکرده باشد.
// تابع خالص است: فرم جدید برمی‌گرداند.
function clearFetched(form, fetched) {
  const next = { ...form };
  Object.entries(fetched).forEach(([field, value]) => {
    const editedByUser = EDITABLE_LOOKUP_FIELDS.includes(field) && form[field] !== value;
    if (!editedByUser) next[field] = EMPTY_FORM[field];
  });
  return next;
}

// چون فایل داریم، داده به‌جای JSON در قالب FormData (multipart) فرستاده می‌شود
function buildFormData(form, moneyField) {
  const data = new FormData();

  data.append("title", form.title.trim());
  data.append("isbn", form.isbn);
  data.append("language", form.language);
  // Only the field for this uploader's role; the backend ignores the other one anyway
  data.append(moneyField, form[moneyField]);

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

  // فایل خود کاربر برنده است؛ cover_url فقط وقتی فرستاده می‌شود که فایلی نیست
  if (form.cover) data.append("cover", form.cover);
  else if (form.cover_url) data.append("cover_url", form.cover_url);
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

// locked: مقدار از Open Library آمده و فقط‌خواندنی است؛ کنار برچسب نشان داده می‌شود
function Field({ id, label, optional, hint, error, locked = false, children }) {
  return (
    <div className="abw-field">
      <label className="abw-label" htmlFor={id}>
        {label}
        {optional && <span className="abw-optional"> (اختیاری)</span>}
        {locked && <span className="abw-source">از Open Library</span>}
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
// readOnly: فقط نمایش نام‌ها، بدون دکمه‌ی حذف و بدون جای تایپ (نویسنده‌های دریافتی از Open Library)
function ChipsInput({ id, values, onChange, placeholder, invalid, readOnly = false }) {
  const [draft, setDraft] = useState("");

  if (readOnly) {
    return (
      <div id={id} className="abw-chips abw-locked" aria-readonly="true">
        {values.map((value) => (
          <span key={value} className="abw-chip abw-chip-locked">
            {value}
          </span>
        ))}
      </div>
    );
  }

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
          <span className="abw-file-size">{formatFileSize(file.size)}</span>
        </>
      ) : (
        <span className="abw-file-name abw-file-empty">انتخاب فایل PDF</span>
      )}
      <input id={id} className="abw-sr-input" type="file" accept=".pdf" onChange={onPick} />
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

// خلاصه‌ی چیزی که Open Library پیدا کرد، در مرحله‌ی شابک. مقدارهای null نمایش داده نمی‌شوند.
function FoundBook({ book }) {
  const [coverFailed, setCoverFailed] = useState(false);
  return (
    <div className="abw-found">
      {book.cover_url && !coverFailed ? (
        <img src={book.cover_url} alt="" onError={() => setCoverFailed(true)} />
      ) : (
        <span className="abw-found-ph" aria-hidden="true">📘</span>
      )}
      <div className="abw-found-body">
        {book.title && <p dir="auto" className="abw-found-title">{book.title}</p>}
        {book.authors.length > 0 && <p dir="auto">{book.authors.join("، ")}</p>}
        <dl>
          {book.publisher && (
            <div>
              <dt>ناشر:</dt>
              <dd dir="auto">{book.publisher}</dd>
            </div>
          )}
          {book.publication_year && (
            <div>
              <dt>سال:</dt>
              <dd>{toFaYear(book.publication_year)}</dd>
            </div>
          )}
          {book.page_count && (
            <div>
              <dt>تعداد صفحات:</dt>
              <dd>{toFaNumber(book.page_count)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

/* ---------- فرم اصلی ---------- */

// /books/new?isbn=9789643113445 (the exchange page's upload button): the ISBN field
// starts filled in. Only the initial value; the user still presses "دریافت اطلاعات"
// and every check runs as usual.
function isbnFromUrl() {
  const isbn = new URLSearchParams(window.location.search).get("isbn") ?? "";
  return /^\d{13}$/.test(isbn) ? isbn : "";
}

export default function AddBookWizard({ onBack }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, isbn: isbnFromUrl() }));
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | submitting | success
  const [step, setStep] = useState(0);
  // دورترین مرحله‌ای که کاربر به آن رسیده؛ تا اینجا را می‌شود از نوار مراحل باز کرد
  const [maxReached, setMaxReached] = useState(0);
  const [coverPreview, setCoverPreview] = useState("");
  const [categories, setCategories] = useState([]);
  // Admin or regular user decides the money field; until known, assume a regular user
  const [isStaff, setIsStaff] = useState(false);
  const moneyField = moneyFieldFor(isStaff);

  // --- دریافت اطلاعات از روی شابک ---
  const [lookupLoading, setLookupLoading] = useState(false);
  // جواب 200 جستجو (برای کارت خلاصه و پیش‌نمایش جلد) یا null
  const [lookupResult, setLookupResult] = useState(null);
  // پیام زیر فیلد شابک که خطای فیلد نیست: { tone: "success" | "warn", text }
  const [lookupNotice, setLookupNotice] = useState(null);
  // جستجو گفته این کتاب در مگابوک هست؛ تا شابک عوض نشود جلو رفتن ممنوع است
  const [isbnTaken, setIsbnTaken] = useState("");
  // مقدارهایی که از Open Library آمد: { title: "…", authors: ["…"], … }
  // هر فیلدی که اینجا هست (جز سال) قفل است. با این می‌دانیم هنگام عوض شدن شابک چه چیزی را پاک کنیم.
  const [fetched, setFetched] = useState({});
  // پیام «اطلاعات شابک قبلی پاک شد»؛ تا جستجوی بعدی می‌ماند، نه فقط تا حرف بعدی
  const [clearedNotice, setClearedNotice] = useState(false);

  const topRef = useRef(null);
  // شماره‌ی آخرین جستجو؛ جوابی که مال شابک قبلی است دور ریخته می‌شود
  const latestLookup = useRef(0);
  const headingRef = useRef(null);
  // بعد از عوض شدن مرحله، کجا برویم: { field } یعنی اولین فیلد خطادار، {} یعنی عنوان مرحله
  const focusRequest = useRef(null);
  const previewRef = useRef("");

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    // Only the form's wording depends on this; the backend decides by the real user
    getCurrentUser()
      .then((user) => setIsStaff(Boolean(user.is_staff)))
      .catch(() => setIsStaff(false));
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

  // فیلد از Open Library آمده و قفل است؟ (سال هیچ‌وقت قفل نیست)
  const isLocked = (name) => name in fetched && !EDITABLE_LOOKUP_FIELDS.includes(name);
  const hasFetched = Object.keys(fetched).length > 0;

  // شابک عوض شد: فرض می‌کنیم کاربر کتاب دیگری را می‌خواهد. نتیجه‌ی جستجوی قبلی (پیام، کارت،
  // پیش‌نمایش جلد، «ثبت شده») و همه‌ی داده‌ی دریافت‌شده پاک می‌شود و قفل‌ها باز می‌شوند.
  // جستجوی در راه هم بی‌اثر می‌شود تا جوابش روی شابک جدید ننشیند.
  const changeIsbn = (value) => {
    setField("isbn", value);
    latestLookup.current += 1;
    setLookupLoading(false);
    setLookupResult(null);
    setLookupNotice(null);
    setIsbnTaken("");

    if (hasFetched) {
      // روی آخرین نسخه‌ی فرم (prev) اعمال می‌شود
      setForm((prev) => clearFetched(prev, fetched));
      setFetched({});
      // فیلدهای پاک‌شده در مرحله‌های دیگرند؛ کاربر باید بداند
      setClearedNotice(true);
    }
  };

  // «اطلاعات درست نیست، خودم وارد می‌کنم»: داده‌ی Open Library کنار می‌رود و کتاب مثل حالتی
  // ثبت می‌شود که «دریافت اطلاعات» زده نشده بود. یا کل داده‌ی Open Library، یا کل ورود دستی.
  const discardFetched = () => {
    setForm((prev) => clearFetched(prev, fetched));
    setFetched({});
    setLookupResult(null);
    setLookupNotice({
      tone: "warn",
      text: "اطلاعات دریافت‌شده کنار گذاشته شد. مشخصات را در مرحله‌های بعد خودتان وارد کنید.",
    });
  };

  const canLookup = form.isbn.length === 13 && !lookupLoading;

  const handleLookup = async () => {
    if (!canLookup) return;
    const lookupId = ++latestLookup.current;
    setLookupLoading(true);
    setLookupResult(null);
    setLookupNotice(null);
    setClearedNotice(false);
    setIsbnTaken("");
    setError("isbn", undefined);

    try {
      const data = await lookupIsbn(form.isbn);
      if (lookupId !== latestLookup.current) return; // در این فاصله شابک عوض شده

      if (data.already_exists) {
        // کتاب در مگابوک هست: هیچ چیز پر نمی‌شود
        setIsbnTaken(takenMessage(data));
        setError("isbn", takenMessage(data));
        return;
      }

      // داده‌ی Open Library معتبر حساب می‌شود: جای هر چه در این فیلدها بود را می‌گیرد (حتی
      // اگر کاربر قبلاً چیزی نوشته بود) و قفل می‌شود. فیلدهایی که Open Library نداد دست نمی‌خورند.
      const values = lookupValues(data);
      const filled = Object.keys(values);
      setForm((prev) => ({ ...prev, ...values }));
      setErrors((prev) => {
        const next = { ...prev };
        filled.forEach((field) => delete next[field]);
        return next;
      });
      setFetched(values);

      setLookupResult(data);
      setLookupNotice(
        filled.length > 0
          ? { tone: "success", text: `اطلاعات دریافت شد: ${filled.map((f) => FIELD_NAMES[f]).join("، ")}` }
          : { tone: "warn", text: "Open Library این کتاب را دارد ولی مشخصاتش خالی است. مشخصات را خودتان وارد کنید." }
      );
    } catch (err) {
      if (lookupId !== latestLookup.current) return;
      const status = err.response?.status;
      const data = err.response?.data;

      if (data?.already_exists) {
        // 404 یا 502 هم already_exists دارند: کتاب در مگابوک هست، حتی اگر Open Library ندارد
        setIsbnTaken(takenMessage(data));
        setError("isbn", takenMessage(data));
      } else if (status === 400 && data?.isbn) {
        // شابک نامعتبر (مثلاً رقم کنترلی): خطای خود فیلد
        setError("isbn", data.isbn[0]);
      } else if ((status === 404 || status === 502) && data?.detail) {
        // پیدا نشد یا Open Library در دسترس نیست: ایراد از ورودی نیست، پس پیام خنثی
        setLookupNotice({ tone: "warn", text: data.detail });
      } else {
        setLookupNotice({
          tone: "warn",
          text:
            status === 401
              ? "برای دریافت اطلاعات ابتدا وارد حساب کاربری شوید."
              : "دریافت اطلاعات انجام نشد. می‌توانید مشخصات را دستی وارد کنید.",
        });
      }
    } finally {
      if (lookupId === latestLookup.current) setLookupLoading(false);
    }
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
      const found = validateStep(i, form, accepted, isbnTaken, moneyField);
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
    latestLookup.current += 1;
    setLookupLoading(false);
    setLookupResult(null);
    setLookupNotice(null);
    setIsbnTaken("");
    setFetched({});
    setClearedNotice(false);
  };

  const handleSubmit = async () => {
    // همه‌ی مرحله‌ها را دوباره چک می‌کنیم؛ ممکن است کاربر برگشته و چیزی را پاک کرده باشد
    for (let i = 0; i < STEPS.length; i++) {
      const found = validateStep(i, form, accepted, isbnTaken, moneyField);
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
      await createBook(buildFormData(form, moneyField));
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
  const languageLabel = form.language ? languageName(form.language) : undefined;
  const categoryName = categories.find((c) => String(c.id) === String(form.category))?.name;

  // خلاصه‌ی مرحله‌ی آخر: هر ردیف با دکمه‌ی «ویرایش» به مرحله‌ی خودش برمی‌گردد
  const summary = [
    { step: 0, label: "شابک", value: form.isbn, ltr: true },
    { step: 1, label: "عنوان", value: form.title.trim() },
    { step: 1, label: "نویسنده‌ها", value: form.authors.join("، ") },
    { step: 2, label: "زبان", value: languageLabel },
    { step: 3, label: "موضوع", value: categoryName },
    { step: 4, label: "فایل کتاب", value: form.book_file?.name, ltr: true },
  ];

  // راهنمای سال: Open Library معمولاً سال میلادی می‌دهد، ولی قرار ما برای کتاب فارسی
  // سال شمسیِ چاپ‌شده در کتاب است. فقط وقتی سال از جستجو آمده و کاربر هنوز عوضش نکرده.
  const yearHint =
    form.language === "fa" &&
    fetched.publication_year &&
    form.publication_year === fetched.publication_year
      ? "این سال از Open Library آمده و ممکن است میلادی باشد. برای کتاب فارسی، سالی را بنویسید که در شناسنامه‌ی کتاب چاپ شده (معمولاً شمسی)."
      : "شمسی یا میلادی، همان‌طور که در شناسنامه‌ی کتاب آمده.";

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
          {/* Admin uploads are approved right away; regular uploads wait for review */}
          <h2>{isStaff ? "کتاب در فروشگاه منتشر شد" : "کتاب برای بررسی ارسال شد"}</h2>
          <p>
            {isStaff
              ? "کتاب همین حالا در فروشگاه نمایش داده می‌شود."
              : "مدیر مگابوک کتاب و مبلغ درخواستی شما را بررسی می‌کند و پس از تایید، کتاب با قیمتی که تعیین می‌شود در فروشگاه نمایش داده می‌شود."}
          </p>
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

          {/* ---------- ۱. شابک و دریافت اطلاعات ---------- */}
          {step === 0 && (
            <section className="abw-section">
              <Field
                id="abw-isbn"
                label="شابک (ISBN-13)"
                hint="با «دریافت اطلاعات»، فیلدهای خالی فرم از Open Library پر می‌شوند. همه را در مرحله‌های بعد می‌توانید اصلاح کنید."
                error={errors.isbn}
              >
                <div className="abw-isbn-row">
                  <input
                    id="abw-isbn"
                    className={inputClass("isbn", "abw-ltr")}
                    inputMode="numeric"
                    value={form.isbn}
                    placeholder="9781234567890"
                    onChange={(e) => changeIsbn(onlyDigits(e.target.value).slice(0, 13))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleLookup();
                      }
                    }}
                  />
                  {/* فقط با ۱۳ رقم فعال است؛ رقم کنترلی را سرور بررسی می‌کند (خطای 400 زیر همین فیلد) */}
                  <button type="button" className="abw-lookup" disabled={!canLookup} onClick={handleLookup}>
                    {lookupLoading && <span className="abw-spinner" aria-hidden="true" />}
                    {lookupLoading ? "در حال دریافت…" : "دریافت اطلاعات"}
                  </button>
                </div>
              </Field>

              {/* پیام‌هایی که خطای فیلد نیستند: پر شدن موفق، پیدا نشدن، در دسترس نبودن */}
              {lookupNotice && (
                <p className={`abw-lookup-msg abw-lookup-${lookupNotice.tone}`} role="status">
                  {lookupNotice.text}
                </p>
              )}

              {/* فیلدهای پاک‌شده در مرحله‌های دیگرند و کاربر نمی‌بیندشان؛ این پیام خبرش می‌کند */}
              {clearedNotice && (
                <p className="abw-lookup-msg abw-lookup-warn" role="status">
                  اطلاعات دریافت‌شده از شابک قبلی پاک شد. برای شابک جدید دوباره «دریافت اطلاعات» را بزنید.
                </p>
              )}

              {lookupResult && <FoundBook book={lookupResult} />}

              {/* راه خروج از داده‌ی قفل‌شده: کل داده‌ی Open Library کنار می‌رود و ورود دستی می‌شود */}
              {hasFetched && (
                <button type="button" className="abw-discard" onClick={discardFetched}>
                  اطلاعات درست نیست، خودم وارد می‌کنم
                </button>
              )}

              <div className="abw-notice">
                <span aria-hidden="true">⚠️</span>
                <span>شابک باید با شابک روی جلد یکی باشد.</span>
              </div>
            </section>
          )}

          {/* ---------- ۲. مشخصات کتاب ---------- */}
          {step === 1 && (
            <section className="abw-section">
              <Field
                id="abw-title"
                label="عنوان کتاب"
                locked={isLocked("title")}
                hint={isLocked("title") ? LOCKED_HINT : undefined}
                error={errors.title}
              >
                <input
                  id="abw-title"
                  className={inputClass("title", isLocked("title") ? "abw-locked" : "")}
                  value={form.title}
                  readOnly={isLocked("title")}
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

              <Field
                id="abw-authors"
                label="نویسنده‌ها"
                locked={isLocked("authors")}
                hint={isLocked("authors") ? LOCKED_HINT : "بعد از هر نام، Enter بزنید."}
                error={errors.authors}
              >
                <ChipsInput
                  id="abw-authors"
                  values={form.authors}
                  invalid={Boolean(errors.authors)}
                  readOnly={isLocked("authors")}
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

          {/* ---------- ۳. اطلاعات نشر ---------- */}
          {step === 2 && (
            <section className="abw-section">
              {/* شابک به مرحله‌ی اول رفت؛ ویرایش حالا تنها در ردیف خودش است */}
              <Field id="abw-edition" label="ویرایش" optional error={errors.edition}>
                <input
                  id="abw-edition"
                  className={inputClass("edition")}
                  value={form.edition}
                  placeholder="مثلاً: دوم"
                  onChange={(e) => setField("edition", e.target.value)}
                />
              </Field>

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

                <Field
                  id="abw-publisher"
                  label="ناشر"
                  optional
                  locked={isLocked("publisher")}
                  hint={isLocked("publisher") ? LOCKED_HINT : undefined}
                  error={errors.publisher}
                >
                  <input
                    id="abw-publisher"
                    className={inputClass("publisher", isLocked("publisher") ? "abw-locked" : "")}
                    value={form.publisher}
                    readOnly={isLocked("publisher")}
                    placeholder="نام ناشر همین نسخه"
                    onChange={(e) => setField("publisher", e.target.value)}
                  />
                </Field>
              </div>

              <div className="abw-row">
                <Field
                  id="abw-page_count"
                  label="تعداد صفحات"
                  optional
                  locked={isLocked("page_count")}
                  hint={isLocked("page_count") ? LOCKED_HINT : undefined}
                  error={errors.page_count}
                >
                  <input
                    id="abw-page_count"
                    className={inputClass("page_count", isLocked("page_count") ? "abw-ltr abw-locked" : "abw-ltr")}
                    inputMode="numeric"
                    value={form.page_count}
                    readOnly={isLocked("page_count")}
                    placeholder="342"
                    onChange={(e) => setField("page_count", onlyDigits(e.target.value).slice(0, 5))}
                  />
                </Field>

                {/* hint روی Field است (نه روی input) تا زیر فیلد نمایش داده شود */}
                <Field
                  id="abw-publication_year"
                  label="سال انتشار"
                  optional
                  hint={yearHint}
                  error={errors.publication_year}
                >
                  <input
                    id="abw-publication_year"
                    className={inputClass("publication_year", "abw-ltr")}
                    inputMode="numeric"
                    value={form.publication_year}
                    onChange={(e) => setField("publication_year", onlyDigits(e.target.value).slice(0, 4))}
                  />
                </Field>
              </div>
            </section>
          )}

          {/* ---------- ۴. توضیحات و دسته‌بندی ---------- */}
          {step === 3 && (
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

          {/* ---------- ۵. جلد و فایل‌ها ---------- */}
          {step === 4 && (
            <section className="abw-section">
              <div className="abw-field">
                <span className="abw-label">تصویر جلد</span>
                {/* سه حالت: فایل خود کاربر (برنده)، جلدی که Open Library پیدا کرد (بک‌اند هنگام
                    ارسال دانلودش می‌کند)، یا هیچ‌کدام. انتخاب فایل همیشه جلد Open Library را کنار می‌گذارد. */}
                <label className={`abw-cover ${errors.cover ? "abw-invalid" : ""}`} htmlFor="abw-cover">
                  {coverPreview ? (
                    <img src={coverPreview} alt="پیش‌نمایش جلد کتاب" />
                  ) : form.cover_url ? (
                    <img
                      src={form.cover_url}
                      alt="جلد کتاب از Open Library"
                      // اگر مرورگر هم نتواند جلد را باز کند، به آن تکیه نمی‌کنیم و کاربر جلد را خودش انتخاب می‌کند
                      onError={() => setField("cover_url", "")}
                    />
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
                    accept=".jpg,.jpeg,.png"
                    onChange={pickCover}
                  />
                </label>
                {coverPreview && !errors.cover && <p className="abw-hint">برای تغییر تصویر، دوباره روی آن بزنید.</p>}
                {!coverPreview && form.cover_url && !errors.cover && (
                  <p className="abw-hint">جلد از Open Library استفاده می‌شود؛ برای تغییر، تصویر دیگری انتخاب کنید</p>
                )}
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

          {/* ---------- ۶. قیمت و ارسال ---------- */}
          {step === 5 && (
            <section className="abw-section">
              <div className="abw-card">
                <div className="abw-price-row">
                  <label className="abw-price-label" htmlFor={`abw-${moneyField}`}>
                    {isStaff ? (
                      <>
                        <strong>قیمت فروش در فروشگاه</strong>
                        <small>کل مبلغ فروش به حساب مگابوک می‌رود.</small>
                      </>
                    ) : (
                      <>
                        <strong>مبلغی که برای هر فروش می‌خواهید دریافت کنید</strong>
                        <small>
                          مدیر مگابوک این مبلغ را بررسی می‌کند. قیمت فروش در فروشگاه را مگابوک تعیین
                          می‌کند.
                        </small>
                      </>
                    )}
                  </label>
                  <div className={`abw-price-input ${errors[moneyField] ? "abw-invalid" : ""}`}>
                    <input
                      id={`abw-${moneyField}`}
                      inputMode="numeric"
                      value={form[moneyField]}
                      placeholder="0"
                      onChange={(e) => setField(moneyField, onlyDigits(e.target.value).slice(0, 9))}
                    />
                    <span>تومان</span>
                  </div>
                </div>
                {form[moneyField] !== "" && !errors[moneyField] && (
                  <p className="abw-hint">
                    {Number(form[moneyField]) > 0
                      ? `${toFaNumber(form[moneyField])} تومان`
                      : isStaff
                        ? "این کتاب رایگان عرضه می‌شود."
                        : "برای فروش این کتاب مبلغی دریافت نمی‌کنید."}
                  </p>
                )}
                {errors[moneyField] && (
                  <p className="abw-error" role="alert">
                    {errors[moneyField]}
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
                {status === "submitting" ? "در حال ارسال…" : isStaff ? "انتشار در فروشگاه" : "ارسال برای بررسی"}
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

/* دریافت اطلاعات از روی شابک */
.abw-isbn-row { display: flex; gap: 8px; align-items: stretch; }
.abw-isbn-row .abw-input { flex: 1; min-width: 0; }
.abw-lookup {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding: 0 14px; border: 1px solid #2563eb; border-radius: 8px;
  background: #eef3ff; color: #1d4ed8;
  font: inherit; font-size: 14px; font-weight: 600; white-space: nowrap; cursor: pointer;
}
.abw-lookup:hover { background: #dbe6fe; }
.abw-lookup:disabled { border-color: #c9cdd4; background: #f4f5f7; color: #9aa0aa; cursor: default; }
.abw-lookup:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.abw-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: abw-spin 0.8s linear infinite;
}
@keyframes abw-spin { to { transform: rotate(360deg); } }
.abw-lookup-msg { margin: -8px 0 16px; font-size: 13px; }
.abw-lookup-success { color: #067647; }
.abw-lookup-warn { color: #b54708; }
.abw-found {
  display: flex; gap: 12px; margin-bottom: 16px; padding: 12px;
  background: #fff; border: 1px solid #dee1e6; border-radius: 12px;
}
.abw-found img, .abw-found-ph {
  width: 64px; height: 96px; flex-shrink: 0; border-radius: 6px;
  object-fit: cover; background: #e9ebef;
}
.abw-found-ph { display: grid; place-items: center; font-size: 24px; }
.abw-found-body { min-width: 0; font-size: 14px; }
.abw-found-body p { margin: 0; }
.abw-found-title { font-weight: 700; }
.abw-found dl { margin: 4px 0 0; font-size: 13px; color: #6b7280; }
.abw-found dl div { display: flex; gap: 4px; }
.abw-found dd { margin: 0; }

/* فیلدهای قفل‌شده (از Open Library) */
.abw .abw-locked { background: #f4f5f7; color: #374151; cursor: default; }
.abw-chip-locked { padding-inline: 10px; }
.abw-source {
  margin-inline-start: 6px; padding: 0 8px; border-radius: 999px;
  background: #eef3ff; color: #1d4ed8; font-size: 11px; font-weight: 600;
}
.abw-discard {
  display: block; margin: -4px 0 16px; padding: 4px 0;
  border: 0; background: none; color: #2563eb;
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: underline;
}
.abw-discard:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }

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
