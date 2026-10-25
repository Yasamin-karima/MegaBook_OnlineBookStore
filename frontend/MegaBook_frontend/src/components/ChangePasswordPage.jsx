import { useState } from "react";
import { changePassword } from "../api/auth";

// ─────────────────────────────────────────────────────────────
// Backend: POST /accounts/me/password/ (src/api/auth.js)
//
// The new password goes through the same rules as sign-up (length, too common,
// only digits, too similar to name/email/phone); the server sends the Persian
// messages. After a change every OTHER device is logged out; this one stays in.
// ─────────────────────────────────────────────────────────────

const FIELDS = ["current_password", "new_password", "confirm_password"];
const EMPTY = { current_password: "", new_password: "", confirm_password: "" };

export default function ChangePasswordPage({ onBack }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
    setDone(false);
  }

  function validate() {
    const next = {};
    if (!form.current_password) next.current_password = "رمز عبور فعلی را وارد کنید.";
    if (!form.new_password) next.new_password = "رمز عبور جدید را وارد کنید.";
    if (form.new_password && form.confirm_password !== form.new_password) {
      next.confirm_password = "تکرار رمز عبور با رمز جدید یکی نیست.";
    }
    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setServerError("");
    const local = validate();
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSaving(true);
    try {
      await changePassword({ current_password: form.current_password, new_password: form.new_password });
      setForm(EMPTY);
      setErrors({});
      setDone(true);
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 400 && data && typeof data === "object") {
        const next = {};
        for (const field of FIELDS) {
          if (Array.isArray(data[field])) next[field] = data[field].join(" ");
        }
        setErrors(next);
        if (!Object.keys(next).length) setServerError("رمز عبور تغییر نکرد. دوباره تلاش کنید.");
      } else {
        setServerError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
      }
    } finally {
      setSaving(false);
    }
  }

  function input(field, label, autoComplete) {
    return (
      <div>
        <label htmlFor={field} className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
        <input
          id={field}
          name={field}
          type="password"
          dir="ltr"
          autoComplete={autoComplete}
          value={form[field]}
          onChange={handleChange}
          aria-invalid={Boolean(errors[field])}
          aria-describedby={errors[field] ? `${field}-error` : undefined}
          className={`h-12 w-full rounded-xl border bg-white px-4 text-left text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
            errors[field] ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-blue-600"
          }`}
        />
        {errors[field] && (
          <p id={`${field}-error`} className="mt-1.5 text-xs text-red-600">
            {errors[field]}
          </p>
        )}
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md">
        <header className="sticky top-16 z-20 md:top-0 flex h-14 items-center justify-between border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <button
            type="button"
            onClick={onBack}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="text-base font-bold text-gray-900">تغییر رمز عبور</h1>
          <span className="h-10 w-10" aria-hidden="true" />
        </header>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="m-4 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {serverError && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              <span aria-hidden="true">⚠️</span>
              <span>{serverError}</span>
            </div>
          )}
          {done && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm leading-6 text-green-700">
              <span aria-hidden="true">✅</span>
              <span>رمز عبور تغییر کرد. از همهٔ دستگاه‌های دیگر خارج شدید؛ این دستگاه وارد می‌ماند.</span>
            </div>
          )}

          {input("current_password", "رمز عبور فعلی", "current-password")}
          {input("new_password", "رمز عبور جدید", "new-password")}
          {input("confirm_password", "تکرار رمز عبور جدید", "new-password")}
          <p className="-mt-2 text-xs leading-5 text-gray-500">
            دست‌کم ۸ کاراکتر، نه فقط عدد، و نه شبیه نام، ایمیل یا شماره موبایل شما.
          </p>

          <button
            type="submit"
            disabled={saving}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
          >
            {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {saving ? "در حال ذخیره…" : "تغییر رمز عبور"}
          </button>
        </form>
      </div>
    </div>
  );
}
