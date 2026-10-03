import { useEffect, useState } from "react";

// داده‌ی نمونه: بعداً از API گرفته می‌شود (GET دسته‌بندی‌ها)
const CATEGORIES = [
  { id: 1, name: "داستان و رمان" },
  { id: 2, name: "سبک زندگی" },
  { id: 3, name: "کودکان" },
  { id: 4, name: "کلاسیک" },
];

// مقدار code همان چیزی است که در فیلد language مدل Book ذخیره می‌شود
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

/* ---------- توابع کمکی ---------- */

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

// خطاها به ترتیب فیلدها در صفحه ساخته می‌شوند تا اولین خطا بالاترین فیلد باشد
function validate(form, accepted) {
  const errors = {};
  if (!form.cover) errors.cover = "تصویر جلد را انتخاب کنید.";
  if (!form.title.trim()) errors.title = "عنوان کتاب را وارد کنید.";
  if (form.authors.length === 0) errors.authors = "دست‌کم نام یک نویسنده را وارد کنید.";
  if (form.isbn.length !== 13) errors.isbn = "شابک باید ۱۳ رقم باشد.";
  if (!form.language) errors.language = "زبان کتاب را انتخاب کنید.";
  if (form.publication_year && form.publication_year.length !== 4) {
    errors.publication_year = "سال را چهاررقمی وارد کنید.";
  }
  if (!form.book_file) errors.book_file = "فایل PDF کتاب را انتخاب کنید.";
  if (form.price === "") errors.price = "قیمت را وارد کنید. برای کتاب رایگان صفر بنویسید.";
  if (!accepted) errors.accepted = "برای ارسال، تایید مالکیت لازم است.";
  return errors;
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

/* ---------- اجزای کوچک ---------- */

function Field({ id, label, optional, hint, error, children }) {
  return (
    <div className="abf-field">
      <label className="abf-label" htmlFor={id}>
        {label}
        {optional && <span className="abf-optional"> (اختیاری)</span>}
      </label>
      {children}
      {hint && !error && <p className="abf-hint">{hint}</p>}
      {error && (
        <p className="abf-error" role="alert">
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
    <div className={`abf-chips ${invalid ? "abf-invalid" : ""}`}>
      {values.map((value) => (
        <span key={value} className="abf-chip">
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
    <label className={`abf-file ${invalid ? "abf-invalid" : ""}`} htmlFor={id}>
      <span aria-hidden="true">📄</span>
      {file ? (
        <>
          <span className="abf-file-name">{file.name}</span>
          <span className="abf-file-size">{formatSize(file.size)}</span>
        </>
      ) : (
        <span className="abf-file-name abf-file-empty">انتخاب فایل PDF</span>
      )}
      <input
        id={id}
        className="abf-sr-input"
        type="file"
        accept="application/pdf"
        onChange={onPick}
      />
    </label>
  );
}

/* ---------- فرم اصلی ---------- */

export default function AddBookForm({ onBack }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | submitting | success
  const [coverPreview, setCoverPreview] = useState("");

  // پیش‌نمایش جلد: یک آدرس موقت برای فایل می‌سازیم و بعد آزادش می‌کنیم
  useEffect(() => {
    if (!form.cover) {
      setCoverPreview("");
      return;
    }
    const url = URL.createObjectURL(form.cover);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [form.cover]);

  const setError = (name, message) => {
    setErrors((prev) => ({ ...prev, [name]: message }));
  };

  // مقدار یک فیلد را عوض می‌کند و خطای همان فیلد را پاک می‌کند
  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setError(name, undefined);
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

  const handleSubmit = async () => {
    const found = validate(form, accepted);
    setErrors(found);

    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      document.getElementById(`abf-${firstInvalid}`)?.scrollIntoView({ block: "center" });
      return;
    }

    const data = buildFormData(form);
    setStatus("submitting");
    try {
      // TODO: اتصال به بک‌اند. این خط با درخواست واقعی جایگزین می‌شود:
      // await api.post("/books/", data);
      console.log("داده‌ی فرم کتاب:", [...data.entries()]);

      setStatus("success");
      setForm(EMPTY_FORM);
      setAccepted(false);
    } catch (err) {
      // TODO: خطاهای بک‌اند (به شکل { field: ["پیام"] }) در errors گذاشته شوند
      setError("form", "ارسال انجام نشد. اتصال اینترنت را بررسی کنید و دوباره بفرستید.");
      setStatus("idle");
    }
  };

  const inputClass = (name, extra = "") =>
    `abf-input ${extra} ${errors[name] ? "abf-invalid" : ""}`;

  return (
    <div className="abf" dir="rtl">
      <style>{styles}</style>

      <header className="abf-header">
        <span />
        <h1>بارگذاری کتاب</h1>
        <button type="button" className="abf-back" aria-label="بازگشت" onClick={handleBack}>
          ‹
        </button>
      </header>

      {status === "success" ? (
        <div className="abf-body abf-success">
          <div className="abf-success-icon" aria-hidden="true">
            ✅
          </div>
          <h2>کتاب برای بررسی ارسال شد</h2>
          <p>پس از تایید مدیر، کتاب در فروشگاه نمایش داده می‌شود.</p>
          <button type="button" className="abf-submit" onClick={() => setStatus("idle")}>
            افزودن کتاب دیگر
          </button>
        </div>
      ) : (
        <div className="abf-body">
          {/* ---------- جلد کتاب ---------- */}
          <section className="abf-section">
            <div className="abf-section-head">
              <h2>جلد کتاب</h2>
              <span className="abf-badge">الزامی</span>
            </div>
            <label
              className={`abf-cover ${errors.cover ? "abf-invalid" : ""}`}
              htmlFor="abf-cover"
            >
              {coverPreview ? (
                <img src={coverPreview} alt="پیش‌نمایش جلد کتاب" />
              ) : (
                <>
                  <span className="abf-cover-icon" aria-hidden="true">
                    📷
                  </span>
                  <span className="abf-cover-title">برای انتخاب تصویر جلد ضربه بزنید</span>
                  <span className="abf-cover-sub">JPG یا PNG، حداکثر ۵ مگابایت</span>
                </>
              )}
              <input
                id="abf-cover"
                className="abf-sr-input"
                type="file"
                accept="image/jpeg,image/png"
                onChange={pickCover}
              />
            </label>
            {coverPreview && !errors.cover && (
              <p className="abf-hint">برای تغییر تصویر، دوباره روی آن بزنید.</p>
            )}
            {errors.cover && (
              <p className="abf-error" role="alert">
                {errors.cover}
              </p>
            )}
          </section>

          {/* ---------- مشخصات کتاب ---------- */}
          <section className="abf-section">
            <div className="abf-section-head">
              <h2>مشخصات کتاب</h2>
            </div>

            <Field id="abf-title" label="عنوان کتاب" error={errors.title}>
              <input
                id="abf-title"
                className={inputClass("title")}
                value={form.title}
                placeholder="مثلاً: کتابخانه نیمه‌شب"
                onChange={(e) => setField("title", e.target.value)}
              />
            </Field>

            <Field
              id="abf-original_title"
              label="عنوان در زبان اصلی"
              optional
              hint="فقط برای کتاب ترجمه‌شده"
              error={errors.original_title}
            >
              <input
                id="abf-original_title"
                className={inputClass("original_title", "abf-ltr")}
                value={form.original_title}
                placeholder="The Midnight Library"
                onChange={(e) => setField("original_title", e.target.value)}
              />
            </Field>

            <Field
              id="abf-authors"
              label="نویسنده‌ها"
              hint="بعد از هر نام، Enter بزنید."
              error={errors.authors}
            >
              <ChipsInput
                id="abf-authors"
                values={form.authors}
                invalid={Boolean(errors.authors)}
                placeholder="نام نویسنده"
                onChange={(list) => setField("authors", list)}
              />
            </Field>

            <Field
              id="abf-translators"
              label="مترجم‌ها"
              optional
              hint="بعد از هر نام، Enter بزنید."
              error={errors.translators}
            >
              <ChipsInput
                id="abf-translators"
                values={form.translators}
                invalid={Boolean(errors.translators)}
                placeholder="نام مترجم"
                onChange={(list) => setField("translators", list)}
              />
            </Field>

            <div className="abf-row">
              <Field id="abf-isbn" label="شابک (ISBN-13)" error={errors.isbn}>
                <input
                  id="abf-isbn"
                  className={inputClass("isbn", "abf-ltr")}
                  inputMode="numeric"
                  value={form.isbn}
                  placeholder="9781234567890"
                  onChange={(e) => setField("isbn", onlyDigits(e.target.value).slice(0, 13))}
                />
              </Field>

              <Field id="abf-edition" label="ویرایش" optional error={errors.edition}>
                <input
                  id="abf-edition"
                  className={inputClass("edition")}
                  value={form.edition}
                  placeholder="مثلاً: دوم"
                  onChange={(e) => setField("edition", e.target.value)}
                />
              </Field>
            </div>

            <div className="abf-row">
              <Field id="abf-language" label="زبان کتاب" error={errors.language}>
                <select
                  id="abf-language"
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

              <Field id="abf-publisher" label="ناشر" optional error={errors.publisher}>
                <input
                  id="abf-publisher"
                  className={inputClass("publisher")}
                  value={form.publisher}
                  placeholder="نام ناشر همین نسخه"
                  onChange={(e) => setField("publisher", e.target.value)}
                />
              </Field>
            </div>

            <div className="abf-row">
              <Field id="abf-page_count" label="تعداد صفحات" optional error={errors.page_count}>
                <input
                  id="abf-page_count"
                  className={inputClass("page_count", "abf-ltr")}
                  inputMode="numeric"
                  value={form.page_count}
                  placeholder="342"
                  onChange={(e) => setField("page_count", onlyDigits(e.target.value).slice(0, 5))}
                />
              </Field>

              <Field
                id="abf-publication_year"
                label="سال انتشار"
                optional
                error={errors.publication_year}
              >
                <input
                  id="abf-publication_year"
                  className={inputClass("publication_year", "abf-ltr")}
                  inputMode="numeric"
                  value={form.publication_year}
                  placeholder="2023"
                  onChange={(e) =>
                    setField("publication_year", onlyDigits(e.target.value).slice(0, 4))
                  }
                />
              </Field>
            </div>

            <Field id="abf-description" label="توضیحات کتاب" optional error={errors.description}>
              <textarea
                id="abf-description"
                className={inputClass("description", "abf-textarea")}
                value={form.description}
                placeholder="خلاصه‌ای کوتاه از محتوای کتاب"
                onChange={(e) => setField("description", e.target.value)}
              />
            </Field>
          </section>

          {/* ---------- دسته‌بندی ---------- */}
          <section className="abf-section">
            <div className="abf-section-head">
              <h2>دسته‌بندی</h2>
            </div>

            <Field id="abf-category" label="موضوع" optional error={errors.category}>
              <select
                id="abf-category"
                className={inputClass("category")}
                value={form.category}
                onChange={(e) => setField("category", e.target.value)}
              >
                <option value="">انتخاب کنید</option>
                {CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="abf-tags"
              label="برچسب‌ها"
              optional
              hint="بعد از هر برچسب، Enter بزنید."
              error={errors.tags}
            >
              <ChipsInput
                id="abf-tags"
                values={form.tags}
                invalid={Boolean(errors.tags)}
                placeholder="مثلاً: فلسفه"
                onChange={(list) => setField("tags", list)}
              />
            </Field>
          </section>

          {/* ---------- فایل‌های کتاب ---------- */}
          <section className="abf-section">
            <div className="abf-section-head">
              <h2>فایل‌های کتاب</h2>
            </div>

            <Field id="abf-book_file" label="فایل کامل کتاب" error={errors.book_file}>
              <PdfPicker
                id="abf-book_file"
                file={form.book_file}
                invalid={Boolean(errors.book_file)}
                onPick={pickPdf("book_file")}
              />
            </Field>

            <Field
              id="abf-sample_file"
              label="فایل نمونه"
              optional
              hint="چند صفحه از کتاب که خریدار پیش از خرید می‌بیند."
              error={errors.sample_file}
            >
              <PdfPicker
                id="abf-sample_file"
                file={form.sample_file}
                invalid={Boolean(errors.sample_file)}
                onPick={pickPdf("sample_file")}
              />
            </Field>
          </section>

          {/* ---------- قیمت و بررسی ---------- */}
          <section className="abf-section">
            <div className="abf-section-head">
              <h2>قیمت و بررسی</h2>
            </div>

            <div className="abf-card">
              <div className="abf-price-row">
                <label className="abf-price-label" htmlFor="abf-price">
                  <strong>قیمت فروش</strong>
                  <small>مدیر این مبلغ را بررسی می‌کند</small>
                </label>
                <div className={`abf-price-input ${errors.price ? "abf-invalid" : ""}`}>
                  <input
                    id="abf-price"
                    inputMode="numeric"
                    value={form.price}
                    placeholder="0"
                    onChange={(e) => setField("price", onlyDigits(e.target.value).slice(0, 9))}
                  />
                  <span>تومان</span>
                </div>
              </div>
              {form.price !== "" && !errors.price && (
                <p className="abf-hint">
                  {Number(form.price) === 0
                    ? "این کتاب رایگان عرضه می‌شود."
                    : `${Number(form.price).toLocaleString("fa-IR")} تومان`}
                </p>
              )}
              {errors.price && (
                <p className="abf-error" role="alert">
                  {errors.price}
                </p>
              )}

              <div className="abf-info">
                <span aria-hidden="true">ℹ️</span>
                <span>
                  کتاب پس از بررسی مدیر منتشر می‌شود. بررسی معمولاً ۱۲ تا ۲۴ ساعت طول می‌کشد.
                </span>
              </div>
            </div>
          </section>

          {/* ---------- تایید مالکیت ---------- */}
          <section className="abf-section">
            <div className="abf-section-head">
              <h2>تایید مالکیت</h2>
            </div>

            <label className="abf-legal" htmlFor="abf-accepted">
              <input
                id="abf-accepted"
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
              <p className="abf-error" role="alert">
                {errors.accepted}
              </p>
            )}

            <div className="abf-notice">
              <span aria-hidden="true">⚠️</span>
              <span>شابک باید با شابک روی جلد یکی باشد و تصویر جلد واضح باشد.</span>
            </div>
          </section>

          {errors.form && (
            <p className="abf-form-error" role="alert">
              {errors.form}
            </p>
          )}

          <button
            type="button"
            className="abf-submit"
            disabled={status === "submitting"}
            onClick={handleSubmit}
          >
            {status === "submitting" ? "در حال ارسال…" : "ارسال برای بررسی"}
          </button>

          <p className="abf-terms">
            با ارسال، <a href="#">قوانین فروشندگان</a> را می‌پذیرید.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------- استایل‌ها ---------- */
// همه‌ی کلاس‌ها با abf- شروع می‌شوند تا با استایل بقیه‌ی برنامه قاطی نشوند

const styles = `
.abf {
  direction: rtl;
  min-height: 100%;
  background: #f4f5f7;
  color: #171a1f;
  font-family: inherit;
  line-height: 1.7;
}
.abf *, .abf *::before, .abf *::after { box-sizing: border-box; }

.abf-header {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #dee1e6;
}
.abf-header h1 { margin: 0; font-size: 20px; font-weight: 700; text-align: center; }
.abf-back {
  width: 44px; height: 44px;
  border: 0; border-radius: 8px;
  background: none; color: inherit;
  font-size: 28px; line-height: 1; cursor: pointer;
}

.abf-body { max-width: 520px; margin: 0 auto; padding: 8px 16px 40px; }

.abf-section { margin-top: 28px; }
.abf-section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.abf-section-head h2 { margin: 0; font-size: 18px; font-weight: 700; }
.abf-badge {
  font-size: 12px; font-weight: 600; color: #2563eb;
  background: #eef3ff; border: 1px solid #93b4f8; border-radius: 999px;
  padding: 0 10px;
}

/* جلد */
.abf-cover {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; height: 240px; overflow: hidden;
  background: #e9ebef; border: 1.5px dashed #bcc1ca; border-radius: 12px;
  text-align: center; cursor: pointer;
}
.abf-cover img { width: 100%; height: 100%; object-fit: contain; }
.abf-cover-icon {
  display: grid; place-items: center;
  width: 56px; height: 56px; border-radius: 50%;
  background: #fff; font-size: 24px;
}
.abf-cover-title { font-size: 15px; font-weight: 600; }
.abf-cover-sub { font-size: 13px; color: #6b7280; }

/* فیلدها */
.abf-field { margin-bottom: 16px; }
.abf-label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 600; }
.abf-optional { font-size: 13px; font-weight: 400; color: #6b7280; }
.abf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.abf-input, .abf-chips, .abf-file {
  width: 100%;
  background: #fff; color: inherit;
  border: 1px solid #c9cdd4; border-radius: 8px;
  font: inherit; font-size: 16px;
}
.abf-input { padding: 10px 14px; }
select.abf-input { height: 49px; }
.abf-textarea { min-height: 110px; resize: vertical; }
.abf-ltr { direction: ltr; text-align: left; }
.abf-input::placeholder, .abf-chips input::placeholder { color: #9aa0aa; }

.abf-input:focus, .abf-chips:focus-within, .abf-file:focus-within,
.abf-cover:focus-within, .abf-price-input:focus-within {
  outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb;
}
.abf-back:focus-visible, .abf-submit:focus-visible {
  outline: 2px solid #2563eb; outline-offset: 2px;
}
.abf .abf-invalid { border-color: #d92d20; }

.abf-hint { margin: 6px 0 0; font-size: 13px; color: #6b7280; }
.abf-error { margin: 6px 0 0; font-size: 13px; color: #b42318; }

/* ورودی چندمقداری */
.abf-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 10px; cursor: text; }
.abf-chips input {
  flex: 1; min-width: 110px; padding: 3px 4px;
  border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 16px;
}
.abf-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding-inline: 10px 4px;
  background: #eef3ff; color: #1d4ed8; border-radius: 999px; font-size: 14px;
}
.abf-chip button {
  border: 0; background: none; color: inherit;
  font-size: 18px; line-height: 1; padding: 2px 6px; cursor: pointer;
}

/* انتخاب فایل */
.abf-file {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; cursor: pointer;
}
.abf-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.abf-file-empty { color: #6b7280; }
.abf-file-size { flex-shrink: 0; font-size: 13px; color: #6b7280; }
.abf-sr-input {
  position: absolute; width: 1px; height: 1px;
  opacity: 0; overflow: hidden; clip-path: inset(50%);
}

/* قیمت */
.abf-card { background: #fff; border: 1px solid #dee1e6; border-radius: 12px; padding: 16px; }
.abf-price-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.abf-price-label strong { display: block; font-size: 15px; }
.abf-price-label small { font-size: 13px; color: #6b7280; }
.abf-price-input {
  display: flex; align-items: center; gap: 6px;
  width: 170px; flex-shrink: 0; padding: 0 12px;
  background: #fff; border: 1px solid #c9cdd4; border-radius: 8px;
}
.abf-price-input input {
  width: 100%; padding: 9px 0;
  border: 0; outline: 0; background: transparent; color: inherit;
  font: inherit; font-size: 17px; font-weight: 700;
  direction: ltr; text-align: left;
}
.abf-price-input span { font-size: 13px; color: #6b7280; }
.abf-info {
  display: flex; gap: 10px; margin-top: 14px; padding: 10px 12px;
  background: #eef3ff; border: 1px solid #c3d4fb; border-radius: 8px;
  font-size: 14px; color: #1e3a8a;
}

/* تایید مالکیت */
.abf-legal {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px; background: #eceef1; border-radius: 8px;
  font-size: 15px; cursor: pointer;
}
.abf-legal input { width: 20px; height: 20px; margin-top: 4px; flex-shrink: 0; accent-color: #2563eb; }
.abf-legal small { display: block; margin-top: 4px; font-size: 13px; color: #6b7280; }
.abf-notice {
  display: flex; gap: 10px; margin-top: 16px; padding: 12px 14px;
  background: #fff; border: 1px solid #dee1e6; border-radius: 10px; font-size: 14px;
}

/* ارسال */
.abf-form-error {
  margin: 20px 0 0; padding: 10px 12px;
  background: #fef3f2; border: 1px solid #fda29b; border-radius: 8px;
  font-size: 14px; color: #b42318;
}
.abf-submit {
  width: 100%; height: 52px; margin-top: 24px;
  border: 0; border-radius: 10px;
  background: #2563eb; color: #fff;
  font: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
}
.abf-submit:hover { background: #1d4fd7; }
.abf-submit:disabled { background: #9db7f5; cursor: default; }
.abf-terms { margin: 12px 0 0; text-align: center; font-size: 13px; color: #6b7280; }
.abf-terms a { color: #2563eb; }

/* پیام موفقیت */
.abf-success { padding-top: 56px; text-align: center; }
.abf-success-icon { font-size: 48px; }
.abf-success h2 { margin: 12px 0 4px; font-size: 20px; }
.abf-success p { margin: 0; color: #6b7280; }
`;
