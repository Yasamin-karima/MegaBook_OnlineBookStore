import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/logo.svg";
// 🔌 اتصال به بکند: POST /accounts/login/ (در src/api/auth.js)
// توکن‌ها همان‌جا در localStorage ذخیره می‌شوند.
// Wrong credentials: 401 with one Persian message in data.detail, which never
// says whether the email/phone has an account.
import { loginUser } from "../api/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  // اگر ProtectedRoute کاربر را به اینجا فرستاده باشد، آدرس صفحه‌ی قبلی در state است
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || "/";
  // مقدار فیلدها (controlled inputs: مقدار هر input از state خوانده می‌شود)
  // identifier: email or mobile number; the backend tells them apart by "@"
  const [form, setForm] = useState({ identifier: "", password: "" });
  // خطای هر فیلد به‌صورت جدا، مثلاً { identifier: "..." }
  const [errors, setErrors] = useState({});
  // خطایی که از سمت سرور می‌آید و مربوط به فیلد خاصی نیست
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // وقتی کاربر شروع به اصلاح می‌کند، خطای همان فیلد پاک شود
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
    if (serverError) setServerError("");
  }

  // اعتبارسنجی سمت کلاینت: فقط برای بازخورد سریع است.
  // اعتبارسنجی اصلی همیشه در جنگو انجام می‌شود.
  function validate() {
    const next = {};
    if (!form.identifier.trim()) next.identifier = "ایمیل یا شماره موبایل را وارد کنید.";
    if (!form.password) next.password = "رمز عبور را وارد کنید.";
    return next;
  }

  async function handleSubmit(e) {
    e.preventDefault(); // جلوی رفرش شدن صفحه را می‌گیرد

    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    setServerError("");

    try {
      await loginUser({
        identifier: form.identifier.trim(),
        password: form.password,
      });

      setSuccess(true);

      // بعد از ورود موفق، پیام موفقیت کوتاه دیده می‌شود و کاربر به صفحه‌ای که می‌خواست
      // (یا صفحه اصلی) می‌رود.
      setTimeout(() => navigate(redirectTo, { replace: true }), 800);
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      if (status === 401) {
        // The backend's Persian message; the fallback only covers an unexpected body
        setServerError(data?.detail || "ایمیل/شماره موبایل یا رمز عبور اشتباه است.");
      } else if (status === 400 && data) {
        // Field errors, e.g. { identifier: ["..."] }
        setErrors({ identifier: data.identifier?.[0], password: data.password?.[0] });
      } else {
        // خطای شبکه یا خطای ۵۰۰ سرور
        setServerError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    // dir="rtl" کل صفحه را راست‌چین می‌کند
    <div dir="rtl" className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        {/* ── سربرگ آبی، هم‌خانواده با کارت پروفایل داشبورد ── */}
        <div className="relative overflow-hidden rounded-3xl bg-blue-600 px-6 pb-14 pt-8 text-white">
          {/* خطوط تزئینی کم‌رنگ، مثل پس‌زمینه کارت داشبورد */}
          <div className="absolute -left-6 top-4 h-24 w-24 rounded-full border-4 border-white/10" />
          <div className="absolute left-16 -top-8 h-20 w-20 rounded-full border-4 border-white/10" />

          <div className="relative">
            {/* لوگوی سایت؛ پس‌زمینه لوگو روشن است، پس روی کارت سفید قرار می‌گیرد */}
            <Link
              to="/"
              className="mb-4 inline-flex rounded-2xl bg-[#f9fcfc] px-3 py-1.5 shadow-sm"
            >
              <img src={logo} alt="مگابوک" className="h-10 w-auto" />
            </Link>
            <h1 className="text-2xl font-bold">ورود به مگابوک</h1>
            <p className="mt-1 text-sm text-blue-100">
              با ایمیل یا شماره موبایل و رمز عبور خود وارد شوید.
            </p>
          </div>
        </div>

        {/* ── کارت فرم، کمی روی سربرگ آبی سوار شده ── */}
        <form
          onSubmit={handleSubmit}
          noValidate // اعتبارسنجی پیش‌فرض مرورگر خاموش؛ پیام‌های فارسی خودمان را نشان می‌دهیم
          className="relative -mt-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {/* پیام خطای سرور، هم‌سبک کادر خطای صفحه «درخواست بر اساس شابک» */}
          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600"
            >
              <span aria-hidden="true">⚠️</span>
              <span>{serverError}</span>
            </div>
          )}

          {success && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700"
            >
              <span aria-hidden="true">✅</span>
              <span>ورود موفق بود.</span>
            </div>
          )}

          {/* ── ایمیل یا شماره موبایل ── */}
          <div>
            <label
              htmlFor="identifier"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              ایمیل یا شماره موبایل
            </label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              dir="ltr" // email and phone are typed left-to-right
              // "username" lets the browser offer saved credentials for this field
              autoComplete="username"
              autoCapitalize="none"
              value={form.identifier}
              onChange={handleChange}
              aria-invalid={Boolean(errors.identifier)}
              aria-describedby={errors.identifier ? "identifier-error" : undefined}
              placeholder="name@example.com / 09123456789"
              className={`h-12 w-full rounded-xl border bg-white px-4 text-left text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                errors.identifier
                  ? "border-red-400 focus:border-red-500"
                  : "border-gray-300 focus:border-blue-600"
              }`}
            />
            {errors.identifier && (
              <p id="identifier-error" className="mt-1.5 text-xs text-red-600">
                {errors.identifier}
              </p>
            )}
          </div>

          {/* ── رمز عبور ── */}
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              رمز عبور
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="current-password"
                value={form.password}
                onChange={handleChange}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
                placeholder="••••••••"
                className={`h-12 w-full rounded-xl border bg-white pl-4 pr-12 text-left text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                  errors.password
                    ? "border-red-400 focus:border-red-500"
                    : "border-gray-300 focus:border-blue-600"
                }`}
              />
              {/* دکمه نمایش/مخفی رمز. type="button" لازم است وگرنه فرم را ارسال می‌کند */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "مخفی کردن رمز عبور" : "نمایش رمز عبور"}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="mt-1.5 text-xs text-red-600">
                {errors.password}
              </p>
            )}
          </div>

          {/* ── دکمه ورود، هم‌سبک دکمه‌های اصلی آبی برنامه ── */}
          <button
            type="submit"
            disabled={loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
          >
            {loading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {loading ? "در حال ورود…" : "ورود"}
          </button>
        </form>

        {/* ── لینک ثبت‌نام ── */}
        <p className="mt-6 text-center text-sm text-gray-500">
          حساب کاربری ندارید؟{" "}
          <Link
            to="/signup"
            className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
          >
            ثبت‌نام کنید
          </Link>
        </p>
      </div>
    </div>
  );
}
