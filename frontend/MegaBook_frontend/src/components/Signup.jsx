import { useState } from "react";
import { Link } from "react-router-dom";
import logo from "../assets/logo.svg";
// ─────────────────────────────────────────────────────────────
// Backend: POST /accounts/register/ (src/api/auth.js)
//
// The user signs up with an email OR a mobile number (they can add the other later).
// The backend normalizes the phone (Persian digits, +98, spaces, ...), checks that
// the email/phone isn't taken, runs Django's password validators, and creates the
// user with create_user so the password is hashed.
//
// On invalid data it returns 400 with Persian messages per field:
//   { "phone": ["..."], "password": ["...", "..."], "non_field_errors": ["..."] }
// ─────────────────────────────────────────────────────────────
import { registerUser } from "../api/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const METHODS = [
    { value: "email", label: "با ایمیل" },
    { value: "phone", label: "با شماره موبایل" },
];

// { field: ["msg", ...] } from DRF -> { field: "msg msg" } for display under each input
function fieldErrors(data) {
    const result = {};
    for (const field of ["first_name", "last_name", "email", "phone", "password"]) {
        if (Array.isArray(data[field])) result[field] = data[field].join(" ");
    }
    return result;
}

export default function SignupPage() {
    const [method, setMethod] = useState("email");
    const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", password: "" });
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

    function changeMethod(next) {
        setMethod(next);
        // The hidden field's error no longer applies
        setErrors((prev) => ({ ...prev, email: "", phone: "" }));
        setServerError("");
    }

    // Client-side checks are only for quick feedback; Django has the final say.
    // The phone format is checked only on the server, where its rules live.
    function validate() {
        const next = {};
        if (!form.first_name.trim()) next.first_name = "نام را وارد کنید.";
        if (!form.last_name.trim()) next.last_name = "نام خانوادگی را وارد کنید.";

        if (method === "email") {
            const email = form.email.trim();
            if (!email) next.email = "ایمیل را وارد کنید.";
            else if (!EMAIL_PATTERN.test(email)) next.email = "ایمیل را به شکل name@example.com وارد کنید.";
        } else if (!form.phone.trim()) {
            next.phone = "شماره موبایل را وارد کنید.";
        }

        if (!form.password) next.password = "رمز عبور را وارد کنید.";
        else if (form.password.length < 8) next.password = "رمز عبور باید دست‌کم ۸ کاراکتر باشد.";

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
            // The backend returns tokens too and registerUser stores them,
            // so the user is logged in right after signing up.
            await registerUser({
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim(),
                // Only the chosen method is sent; the other one is null
                email: method === "email" ? form.email.trim() : null,
                phone: method === "phone" ? form.phone.trim() : null,
                password: form.password,
            });
            setSuccess(true);
        } catch (err) {
            const status = err.response?.status;
            const data = err.response?.data;
            if (status === 400 && data) {
                // The backend's Persian messages, next to the field they belong to
                setErrors(fieldErrors(data));
                // Errors not tied to one field (e.g. "enter an email or phone")
                const general = Array.isArray(data) ? data : data.non_field_errors;
                if (general?.length) setServerError(general.join(" "));
            } else {
                setServerError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
            }
        } finally {
            setLoading(false);
        }
    }

    // Shared input classes; only the border color changes with an error
    function inputClass(field, extra = "") {
        return `h-12 w-full rounded-xl border bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${extra} ${errors[field]
                ? "border-red-400 focus:border-red-500"
                : "border-gray-300 focus:border-blue-600"
            }`;
    }

    function errorText(field) {
        return errors[field] ? (
            <p id={`${field}-error`} className="mt-1.5 text-xs text-red-600">
                {errors[field]}
            </p>
        ) : null;
    }

    // ── Success: a confirmation replaces the form ──
    if (success) {
        return (
            <div dir="rtl" className="min-h-screen bg-gray-100 px-4 py-10">
                <div className="mx-auto w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-3xl">
                        ✅
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">حساب شما ساخته شد</h1>
                    <p className="mt-2 text-sm text-gray-500">
                        {form.first_name.trim()} عزیز، خوش آمدید. شما وارد حساب خود شده‌اید.
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                        دفعه‌های بعد با{" "}
                        <span dir="ltr" className="font-semibold text-gray-700">
                            {method === "email" ? form.email.trim() : form.phone.trim()}
                        </span>{" "}
                        و رمز عبورتان وارد شوید.
                    </p>
                    <Link
                        to="/"
                        className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
                    >
                        رفتن به صفحه اصلی
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div dir="rtl" className="min-h-screen bg-gray-100 px-4 py-10">
            <div className="mx-auto w-full max-w-sm">
                {/* ── Blue header, like the login page ── */}
                <div className="relative overflow-hidden rounded-3xl bg-blue-600 px-6 pb-14 pt-8 text-white">
                    <div className="absolute -left-6 top-4 h-24 w-24 rounded-full border-4 border-white/10" />
                    <div className="absolute left-16 -top-8 h-20 w-20 rounded-full border-4 border-white/10" />

                    <div className="relative">
                        {/* The logo has a light background, so it sits on a white card */}
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

                    {/* ── First and last name, side by side ── */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="first_name" className="mb-1.5 block text-sm font-medium text-gray-700">
                                نام
                            </label>
                            <input
                                id="first_name"
                                name="first_name"
                                type="text"
                                autoComplete="given-name"
                                value={form.first_name}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.first_name)}
                                aria-describedby={errors.first_name ? "first_name-error" : undefined}
                                className={inputClass("first_name", "px-4")}
                            />
                            {errorText("first_name")}
                        </div>
                        <div>
                            <label htmlFor="last_name" className="mb-1.5 block text-sm font-medium text-gray-700">
                                نام خانوادگی
                            </label>
                            <input
                                id="last_name"
                                name="last_name"
                                type="text"
                                autoComplete="family-name"
                                value={form.last_name}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.last_name)}
                                aria-describedby={errors.last_name ? "last_name-error" : undefined}
                                className={inputClass("last_name", "px-4")}
                            />
                            {errorText("last_name")}
                        </div>
                    </div>

                    {/* ── Email or phone: the user picks one ── */}
                    <div>
                        <span id="method-label" className="mb-1.5 block text-sm font-medium text-gray-700">
                            ثبت‌نام
                        </span>
                        <div
                            role="radiogroup"
                            aria-labelledby="method-label"
                            className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1"
                        >
                            {METHODS.map((m) => (
                                <button
                                    key={m.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={method === m.value}
                                    onClick={() => changeMethod(m.value)}
                                    className={`h-10 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${method === m.value
                                            ? "bg-white text-blue-600 shadow-sm"
                                            : "text-gray-500 hover:text-gray-700"
                                        }`}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {method === "email" ? (
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
                                inputMode="email" // mobile keyboards show the @ key
                                value={form.email}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.email)}
                                aria-describedby={errors.email ? "email-error" : undefined}
                                placeholder="name@example.com"
                                className={inputClass("email", "px-4 text-left")}
                            />
                            {errorText("email")}
                        </div>
                    ) : (
                        <div>
                            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-gray-700">
                                شماره موبایل
                            </label>
                            <input
                                id="phone"
                                name="phone"
                                type="tel"
                                dir="ltr"
                                autoComplete="tel"
                                inputMode="tel" // mobile keyboards show the number pad
                                value={form.phone}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.phone)}
                                aria-describedby={errors.phone ? "phone-error" : undefined}
                                placeholder="09123456789"
                                className={inputClass("phone", "px-4 text-left")}
                            />
                            {errorText("phone")}
                        </div>
                    )}

                    {/* ── Password ── */}
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
                                autoComplete="new-password" // tells the browser to suggest a new password
                                value={form.password}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.password)}
                                aria-describedby="password-hint"
                                placeholder="••••••••"
                                className={inputClass("password", "pl-4 pr-12 text-left")}
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
                        {/* The hint is always shown; an error replaces it */}
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
