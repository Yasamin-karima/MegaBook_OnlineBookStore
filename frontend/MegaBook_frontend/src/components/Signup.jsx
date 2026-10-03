import { useState } from "react";
import { Link } from "react-router-dom";
import logo from "../assets/logo.svg";
// ─────────────────────────────────────────────────────────────
// 🔌 اتصال به بکند: POST /accounts/register/ (در src/api/auth.js)
//
// RegisterSerializer در جنگو:
//   ۱. یکتا بودن username و email را چک می‌کند،
//   ۲. رمز را با validate_password جنگو بررسی می‌کند (حداقل ۸ کاراکتر، خیلی ساده نباشد، ...)،
//   ۳. کاربر را با create_user(...) می‌سازد تا رمز هش شود.
//
// اگر داده نامعتبر باشد، DRF وضعیت 400 و خطاها را به این شکل برمی‌گرداند:
//   { "username": ["A user with that username already exists."],
//     "email": ["..."] }
// ─────────────────────────────────────────────────────────────
import { registerUser } from "../api/auth";

// پیام‌های انگلیسی DRF را به فارسی تبدیل می‌کند.
// هر پیام ناشناخته‌ای هم یک پیام فارسی عمومی می‌گیرد تا متن انگلیسی به کاربر نرسد.
function translateServerErrors(data) {
    const result = {};
    if (data.username) {
        result.username = data.username[0].includes("already exists")
            ? "این نام کاربری قبلاً ثبت شده است."
            : "نام کاربری معتبر نیست.";
    }
    if (data.email) {
        result.email = data.email[0].includes("already exists")
            ? "با این ایمیل قبلاً حساب ساخته شده است."
            : "ایمیل معتبر نیست.";
    }
    if (data.password) {
        // خطاهای validate_password جنگو (مثلاً «رمز خیلی رایج است»)
        result.password = "این رمز عبور خیلی ساده است. رمز قوی‌تری انتخاب کنید.";
    }
    return result;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage() {
    const [form, setForm] = useState({ username: "", email: "", password: "" });
    const [errors, setErrors] = useState({});
    const [serverError, setServerError] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    function handleChange(e) {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
        if (serverError) setServerError("");
    }

    // اعتبارسنجی سمت کلاینت (فقط برای بازخورد سریع؛ مرجع نهایی جنگو است)
    function validate() {
        const next = {};
        const username = form.username.trim();
        const email = form.email.trim();

        if (!username) next.username = "نام کاربری را وارد کنید.";
        else if (/\s/.test(username)) next.username = "نام کاربری نباید فاصله داشته باشد.";
        else if (username.length > 150) next.username = "نام کاربری حداکثر ۱۵۰ کاراکتر است.";

        if (!email) next.email = "ایمیل را وارد کنید.";
        else if (!EMAIL_PATTERN.test(email)) next.email = "ایمیل را به شکل name@example.com وارد کنید.";

        if (!form.password) next.password = "رمز عبور را وارد کنید.";
        else if (form.password.length < 8) next.password = "رمز عبور باید حداقل ۸ کاراکتر باشد.";

        return next;
    }

    async function handleSubmit(e) {
        e.preventDefault();

        const next = validate();
        setErrors(next);
        if (Object.keys(next).length > 0) return;

        setLoading(true);
        setServerError("");

        try {
            // بکند همان لحظه توکن هم برمی‌گرداند و registerUser آن را ذخیره می‌کند،
            // پس کاربر بعد از ثبت‌نام وارد شده است.
            await registerUser({
                username: form.username.trim(),
                email: form.email.trim(),
                password: form.password,
            });
            setSuccess(true);
        } catch (err) {
            const status = err.response?.status;
            if (status === 400 && err.response.data) {
                // خطاها کنار همان فیلدی که مشکل دارد نشان داده می‌شوند
                setErrors(translateServerErrors(err.response.data));
            } else {
                setServerError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
            }
        } finally {
            setLoading(false);
        }
    }

    // کلاس‌های مشترک inputها؛ فقط رنگ حاشیه بسته به خطا عوض می‌شود
    function inputClass(field, extra = "") {
        return `h-12 w-full rounded-xl border bg-white text-left text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${extra} ${errors[field]
                ? "border-red-400 focus:border-red-500"
                : "border-gray-300 focus:border-blue-600"
            }`;
    }

    // ── حالت موفق: به‌جای فرم، پیام تأیید نمایش داده می‌شود ──
    if (success) {
        return (
            <div dir="rtl" className="min-h-screen bg-gray-100 px-4 py-10">
                <div className="mx-auto w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-3xl">
                        ✅
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">حساب شما ساخته شد</h1>
                    <p className="mt-2 text-sm text-gray-500">
                        حالا می‌توانید با نام کاربری{" "}
                        <span dir="ltr" className="font-semibold text-gray-700">
                            {form.username.trim()}
                        </span>{" "}
                        وارد شوید.
                    </p>
                    <Link
                        to="/login"
                        className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
                    >
                        رفتن به صفحه ورود
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div dir="rtl" className="min-h-screen bg-gray-100 px-4 py-10">
            <div className="mx-auto w-full max-w-sm">
                {/* ── سربرگ آبی، مثل صفحه ورود ── */}
                <div className="relative overflow-hidden rounded-3xl bg-blue-600 px-6 pb-14 pt-8 text-white">
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
                        <h1 className="text-2xl font-bold">ساخت حساب مگابوک</h1>
                        <p className="mt-1 text-sm text-blue-100">
                            برای خرید، درخواست و بارگذاری کتاب حساب بسازید.
                        </p>
                    </div>
                </div>

                <form
                    onSubmit={handleSubmit}
                    noValidate
                    className="relative -mt-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
                >
                    {serverError && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600"
                        >
                            <span aria-hidden="true">⚠️</span>
                            <span>{serverError}</span>
                        </div>
                    )}

                    {/* ── نام کاربری ── */}
                    <div>
                        <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-gray-700">
                            نام کاربری
                        </label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            dir="ltr"
                            autoComplete="username"
                            autoCapitalize="none"
                            value={form.username}
                            onChange={handleChange}
                            aria-invalid={Boolean(errors.username)}
                            aria-describedby={errors.username ? "username-error" : undefined}
                            placeholder="username"
                            className={inputClass("username", "px-4")}
                        />
                        {errors.username && (
                            <p id="username-error" className="mt-1.5 text-xs text-red-600">
                                {errors.username}
                            </p>
                        )}
                    </div>

                    {/* ── ایمیل ── */}
                    <div>
                        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
                            ایمیل
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            dir="ltr"
                            autoComplete="email"
                            inputMode="email" // در موبایل کیبورد مخصوص ایمیل (با @) باز می‌شود
                            value={form.email}
                            onChange={handleChange}
                            aria-invalid={Boolean(errors.email)}
                            aria-describedby={errors.email ? "email-error" : undefined}
                            placeholder="name@example.com"
                            className={inputClass("email", "px-4")}
                        />
                        {errors.email && (
                            <p id="email-error" className="mt-1.5 text-xs text-red-600">
                                {errors.email}
                            </p>
                        )}
                    </div>

                    {/* ── رمز عبور ── */}
                    <div>
                        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
                            رمز عبور
                        </label>
                        <div className="relative">
                            <input
                                id="password"
                                name="password"
                                type={showPassword ? "text" : "password"}
                                dir="ltr"
                                autoComplete="new-password" // به مرورگر می‌گوید رمز جدید پیشنهاد دهد
                                value={form.password}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.password)}
                                aria-describedby="password-hint"
                                placeholder="••••••••"
                                className={inputClass("password", "pl-4 pr-12")}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={showPassword ? "مخفی کردن رمز عبور" : "نمایش رمز عبور"}
                                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
                            >
                                {showPassword ? "🙈" : "👁️"}
                            </button>
                        </div>
                        {/* راهنما همیشه دیده می‌شود؛ اگر خطا باشد، متن خطا جایش را می‌گیرد */}
                        <p
                            id="password-hint"
                            className={`mt-1.5 text-xs ${errors.password ? "text-red-600" : "text-gray-500"}`}
                        >
                            {errors.password || "حداقل ۸ کاراکتر، ترکیبی از حروف و عدد"}
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
                    >
                        {loading && (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        )}
                        {loading ? "در حال ساخت حساب…" : "ساخت حساب"}
                    </button>
                </form>

                <p className="mt-6 text-center text-sm text-gray-500">
                    قبلاً ثبت‌نام کرده‌اید؟{" "}
                    <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">
                        وارد شوید
                    </Link>
                </p>
            </div>
        </div>
    );
}
