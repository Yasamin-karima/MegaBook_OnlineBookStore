import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
// ─────────────────────────────────────────────────────────────
// Backend: GET / PATCH /accounts/me/ (src/api/auth.js)
//
// The user edits their names, email and phone. Only changed fields are sent.
// Adding, changing or removing email/phone needs the current password (so a
// stolen token alone can't take over the account); names don't.
// At least one of email or phone must remain; the backend enforces it too.
// ─────────────────────────────────────────────────────────────
import { getCurrentUser, logoutUser, updateCurrentUser } from "../api/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = ["first_name", "last_name", "email", "phone", "current_password"];

// The form's values for a user from the backend (null email/phone -> "")
function formFrom(user) {
    return {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email || "",
        phone: user.phone || "",
        current_password: "",
    };
}

// { field: ["msg", ...] } from DRF -> { field: "msg msg" } for display under each input
function fieldErrors(data) {
    const result = {};
    for (const field of FIELDS) {
        if (Array.isArray(data[field])) result[field] = data[field].join(" ");
    }
    return result;
}

export default function AccountPage({ onBack }) {
    const navigate = useNavigate();
    const location = useLocation();
    // The user as saved on the server; the form is compared to it to find changes
    const [user, setUser] = useState(null);
    const [form, setForm] = useState(null);
    const [loadError, setLoadError] = useState("");
    const [errors, setErrors] = useState({});
    const [serverError, setServerError] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getCurrentUser()
            .then((data) => {
                if (cancelled) return;
                setUser(data);
                setForm(formFrom(data));
            })
            .catch((err) => {
                if (cancelled) return;
                if (err.response?.status === 401) {
                    // The session ended (refresh token expired or revoked): log in again
                    navigate("/login", { replace: true, state: { from: location } });
                } else {
                    setLoadError("اطلاعات حساب دریافت نشد. دوباره تلاش کنید.");
                }
            });
        return () => {
            cancelled = true;
        };
        // Runs once: navigate is stable and location doesn't change while on this page
    }, [navigate, location]);

    if (loadError) {
        return (
            <PageShell onBack={onBack}>
                <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                    {loadError}
                </div>
            </PageShell>
        );
    }

    if (!form) {
        return (
            <PageShell onBack={onBack}>
                <div className="flex justify-center py-16" aria-label="در حال بارگذاری">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600/30 border-t-blue-600" />
                </div>
            </PageShell>
        );
    }

    const contactChanged =
        form.email.trim() !== (user.email || "") || form.phone.trim() !== (user.phone || "");
    // Also shown when the server asks for it, in case our comparison missed a change
    const showPassword = contactChanged || Boolean(errors.current_password);

    function handleChange(e) {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
        if (serverError) setServerError("");
        setSaved(false);
    }

    // Only the fields that differ from the saved user; "" email/phone becomes null (removes it)
    function changes() {
        const result = {};
        for (const field of ["first_name", "last_name"]) {
            if (form[field].trim() !== user[field]) result[field] = form[field].trim();
        }
        for (const field of ["email", "phone"]) {
            if (form[field].trim() !== (user[field] || "")) result[field] = form[field].trim() || null;
        }
        if (contactChanged) result.current_password = form.current_password;
        return result;
    }

    // Client-side checks are only for quick feedback; Django has the final say.
    function validate() {
        const next = {};
        if (!form.first_name.trim()) next.first_name = "نام را وارد کنید.";
        if (!form.last_name.trim()) next.last_name = "نام خانوادگی را وارد کنید.";
        const email = form.email.trim();
        if (email && !EMAIL_PATTERN.test(email)) next.email = "ایمیل را به شکل name@example.com وارد کنید.";
        if (!email && !form.phone.trim()) {
            next.phone = "دست‌کم یکی از ایمیل و شماره موبایل باید بماند.";
        }
        if (contactChanged && !form.current_password) {
            next.current_password = "برای تغییر ایمیل یا شماره موبایل، رمز عبور فعلی را وارد کنید.";
        }
        return next;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaved(false);

        const next = validate();
        setErrors(next);
        if (Object.keys(next).length > 0) return;

        const payload = changes();
        if (Object.keys(payload).length === 0) {
            setServerError("تغییری برای ذخیره وجود ندارد.");
            return;
        }

        setSaving(true);
        setServerError("");
        try {
            const updated = await updateCurrentUser(payload);
            setUser(updated);
            // Shows the stored form, e.g. the phone as 09xxxxxxxxx; clears the password
            setForm(formFrom(updated));
            setSaved(true);
        } catch (err) {
            const status = err.response?.status;
            const data = err.response?.data;
            if (status === 400 && data) {
                setErrors(fieldErrors(data));
                const general = Array.isArray(data) ? data : data.non_field_errors;
                if (general?.length) setServerError(general.join(" "));
            } else {
                setServerError("ارتباط با سرور برقرار نشد. دوباره تلاش کنید.");
            }
        } finally {
            setSaving(false);
        }
    }

    async function handleLogout() {
        await logoutUser();
        navigate("/", { replace: true });
    }

    function inputClass(field, extra = "") {
        return `h-12 w-full rounded-xl border bg-white px-4 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${extra} ${errors[field]
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

    function input(field, label, props = {}) {
        return (
            <div>
                <label htmlFor={field} className="mb-1.5 block text-sm font-medium text-gray-700">
                    {label}
                </label>
                <input
                    id={field}
                    name={field}
                    value={form[field]}
                    onChange={handleChange}
                    aria-invalid={Boolean(errors[field])}
                    aria-describedby={errors[field] ? `${field}-error` : undefined}
                    {...props}
                    className={inputClass(field, props.dir === "ltr" ? "text-left" : "")}
                />
                {errorText(field)}
            </div>
        );
    }

    return (
        <PageShell onBack={onBack}>
            <form
                onSubmit={handleSubmit}
                noValidate
                className="m-4 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
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
                {saved && (
                    <div
                        role="status"
                        className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700"
                    >
                        <span aria-hidden="true">✅</span>
                        <span>تغییرات ذخیره شد.</span>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                    {input("first_name", "نام", { type: "text", autoComplete: "given-name" })}
                    {input("last_name", "نام خانوادگی", { type: "text", autoComplete: "family-name" })}
                </div>

                {input("email", "ایمیل", {
                    type: "email", dir: "ltr", autoComplete: "email", inputMode: "email",
                    placeholder: "name@example.com",
                })}
                {input("phone", "شماره موبایل", {
                    type: "tel", dir: "ltr", autoComplete: "tel", inputMode: "tel",
                    placeholder: "09123456789",
                })}
                <p className="-mt-2 text-xs text-gray-500">
                    با هر کدام از ایمیل و شماره موبایل که ثبت کرده‌اید می‌توانید وارد شوید. برای حذف یکی،
                    آن را خالی بگذارید؛ دست‌کم یکی باید بماند.
                </p>

                {showPassword &&
                    input("current_password", "رمز عبور فعلی", {
                        type: "password", dir: "ltr", autoComplete: "current-password",
                        placeholder: "••••••••",
                    })}

                <button
                    type="submit"
                    disabled={saving}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
                >
                    {saving && (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                    {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
                </button>
            </form>

            <div className="mx-4 space-y-3">
                <Link
                    to="/wallet"
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white font-semibold text-gray-800 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
                >
                    <span aria-hidden="true">👛</span>
                    کیف پول
                </Link>
                {/* Only for staff; the dashboard itself is protected by the backend (404 for others) */}
                {user?.is_staff && (
                    <Link
                        to="/admin"
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-900 bg-gray-900 font-semibold text-white transition-colors hover:bg-gray-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
                    >
                        <span aria-hidden="true">🛠️</span>
                        داشبورد مدیریت
                    </Link>
                )}
                <button
                    type="button"
                    onClick={handleLogout}
                    className="flex h-12 w-full items-center justify-center rounded-xl border border-red-200 bg-white font-semibold text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-600/20"
                >
                    خروج از حساب
                </button>
            </div>
        </PageShell>
    );
}

// The same header as the other inner pages (RequestByIsbnPage); onBack comes from the router (App.jsx)
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
                    <h1 className="text-base font-bold text-gray-900">حساب کاربری</h1>
                    {/* Same width as the back button, so the title stays centered */}
                    <span className="h-10 w-10" aria-hidden="true" />
                </header>
                {children}
            </div>
        </div>
    );
}
