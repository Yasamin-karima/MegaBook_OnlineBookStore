import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { logoutUser } from "../api/auth";
import { getDashboard } from "../api/dashboard";
import { formatPrice, toFaNumber } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند: GET /dashboard/ (src/api/dashboard.js)
//
// چرا یک endpoint جدا و نه چند درخواست به endpointهای موجود؟
// داشبورد فقط «عدد» لازم دارد، نه لیست. اگر برای هر عدد لیست کامل
// درخواست‌ها و آپلودها را بگیریم، داده‌ای منتقل می‌شود که دور ریخته می‌شود.
// سرور همهٔ عددها را با چند کوئری شمارشی/جمع (aggregate) در لحظه حساب می‌کند؛
// موجودی و درآمد از دفتر تراکنش‌های کیف پول می‌آیند.
// ═════════════════════════════════════════════════════════════

// حروف اول نام و نام خانوادگی، به‌جای عکس پروفایل: «ی ک»
function initials(user) {
  return [user.first_name, user.last_name]
    .filter(Boolean)
    .map((s) => s.trim().charAt(0))
    .join(" ");
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboard()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 401) {
          // The session ended (refresh token expired or revoked): log in again
          navigate("/login", { replace: true, state: { from: location } });
        } else {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, navigate, location]);

  function retry() {
    setStatus("loading");
    setReloadKey((k) => k + 1);
  }

  async function handleLogout() {
    setLoggingOut(true);
    // logoutUser clears the tokens in the browser first, then asks the server to
    // blacklist the refresh token; even if that request fails, the user is logged out
    await logoutUser();
    navigate("/login", { replace: true });
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md">
        {/* ═══ نوار بالا ═══
            زنگ اعلان‌ها برداشته شد: اعلان‌ها هنوز بک‌اند ندارند. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <Link
            to="/"
            aria-label="بازگشت به فروشگاه"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200"
          >
            →
          </Link>
          <h1 className="text-lg font-bold text-gray-900">داشبورد</h1>
        </header>

        {status === "loading" && <DashboardSkeleton />}

        {status === "error" && (
          <div className="mx-4 mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-3 text-4xl">⚠️</div>
            <h2 className="text-lg font-bold text-gray-900">داشبورد بارگذاری نشد</h2>
            <p className="mt-2 text-sm text-gray-500">اتصال اینترنت را بررسی کنید.</p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 h-11 w-full rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700"
            >
              تلاش دوباره
            </button>
          </div>
        )}

        {status === "ready" && (
          <>
            {/* ═══ کارت پروفایل و کیف پول ═══
                کیف پول داخل همین کارت آبی آمده، چون مهم‌ترین عدد داشبورد است.
                در طرح Visily یک کارت سفید جدا زیر پروفایل بود. */}
            <section className="relative mx-4 mt-4 overflow-hidden rounded-3xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <div className="absolute -left-6 top-4 h-24 w-24 rounded-full border-4 border-white/10" />
              <div className="absolute left-16 -top-8 h-20 w-20 rounded-full border-4 border-white/10" />

              {/* کل بخش پروفایل به صفحهٔ «حساب کاربری» (ویرایش نام، ایمیل و موبایل) می‌رود */}
              <Link
                to="/account"
                className="relative flex items-center gap-4 p-5 transition-colors hover:bg-white/5 focus:outline-none focus-visible:bg-white/10"
              >
                <div
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold ring-2 ring-white/30"
                >
                  {initials(data.user)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">
                    {data.user.first_name} {data.user.last_name}
                  </p>
                  {/* فقط همانی که ثبت شده؛ ایمیل و شماره لاتین‌اند، پس dir="ltr" */}
                  {data.user.email && (
                    <p dir="ltr" className="truncate text-right text-sm text-blue-100">
                      {data.user.email}
                    </p>
                  )}
                  {data.user.phone && (
                    <p dir="ltr" className="text-right text-sm text-blue-100">
                      {data.user.phone}
                    </p>
                  )}
                </div>
                <span aria-hidden="true" className="text-blue-200">
                  ‹
                </span>
              </Link>

              <Link
                to="/wallet"
                className="relative flex items-center justify-between border-t border-white/15 bg-white/10 px-5 py-4 transition-colors hover:bg-white/15 focus:outline-none focus-visible:bg-white/20"
              >
                <span className="flex items-center gap-2 text-sm text-blue-100">
                  <span aria-hidden="true">👛</span>
                  موجودی کیف پول
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xl font-bold">{toFaNumber(data.wallet.balance)}</span>
                  <span className="text-sm text-blue-100">تومان</span>
                  <span aria-hidden="true" className="text-blue-200">
                    ‹
                  </span>
                </span>
              </Link>
            </section>

            {/* ═══ سبد خرید ═══ */}
            <Link
              to="/cart"
              className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl" aria-hidden="true">
                🛒
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-gray-900">سبد خرید</span>
                <span className="block text-sm text-gray-500">
                  {data.cart.count > 0 ? `${toFaNumber(data.cart.count)} کتاب` : "سبد خرید خالی است"}
                </span>
              </span>
              {data.cart.count > 0 && (
                <span className="font-bold text-blue-600">{formatPrice(data.cart.total)}</span>
              )}
              <span className="text-gray-400" aria-hidden="true">
                ‹
              </span>
            </Link>

            {/* ═══ درخواست‌های من ═══
                صفحهٔ «درخواست‌های من» هنوز نیست؛ کاشی‌ها فعلاً فقط عددند (TODO: لینک به
                /requests?status=… وقتی آن صفحه ساخته شد). */}
            <StatSection
              title="درخواست‌های من"
              stats={[
                { key: "open", label: "در انتظار تأمین", value: data.requests.open, tone: "amber" },
                { key: "fulfilled", label: "تأمین‌شده", value: data.requests.fulfilled, tone: "green" },
                { key: "rejected", label: "ردشده", value: data.requests.rejected, tone: "red" },
              ]}
              action={{ text: "درخواست تازه", href: "/requests/new" }}
              empty={{
                text: "هنوز کتابی درخواست نداده‌اید.",
                cta: "درخواست با شابک",
                href: "/requests/new",
              }}
            />

            {/* ═══ آپلودهای من ═══
                «پرداخت‌شده» طرح Visily حذف شد: سهم فروشنده با هر فروش مستقیم به
                کیف پولش می‌رود، پس کتاب وضعیتی به اسم «پرداخت‌شده» ندارد. به‌جایش
                تعداد فروش و درآمد کل (از دفتر تراکنش‌های کیف پول) نمایش داده می‌شود. */}
            <StatSection
              title="آپلودهای من"
              stats={[
                { key: "pending", label: "در انتظار تأیید", value: data.uploads.pending, tone: "amber" },
                { key: "approved", label: "در فروشگاه", value: data.uploads.approved, tone: "green" },
                { key: "rejected", label: "ردشده", value: data.uploads.rejected, tone: "red" },
              ]}
              // صفحهٔ کتابخانه فعلاً فیلتر وضعیت ندارد؛ همهٔ کاشی‌ها به تب بارگذاری‌شده می‌روند
              statHref={() => "/library?tab=uploaded"}
              action={{ text: "مشاهدهٔ همه ‹", href: "/library?tab=uploaded" }}
              empty={{
                text: "هنوز کتابی بارگذاری نکرده‌اید.",
                cta: "بارگذاری کتاب",
                href: "/books/new",
              }}
            >
              <div className="mt-2 grid grid-cols-2 divide-x divide-x-reverse divide-gray-100 rounded-2xl border border-gray-200 bg-white text-center shadow-sm">
                <div className="px-3 py-3">
                  <p className="text-xs text-gray-500">تعداد فروش</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{toFaNumber(data.uploads.sales)}</p>
                </div>
                <div className="px-3 py-3">
                  <p className="text-xs text-gray-500">درآمد کل</p>
                  <p className="mt-1 text-lg font-bold text-green-700">
                    {toFaNumber(data.uploads.earnings)} <span className="text-xs font-normal text-gray-500">تومان</span>
                  </p>
                </div>
              </div>
            </StatSection>

            {/* ═══ حساب کاربری ═══
                «درخواست پشتیبانی» برداشته شد: پشتیبانی هنوز بک‌اند ندارد. */}
            <section className="mx-4 mt-6">
              <h2 className="mb-2 text-base font-bold text-gray-900">حساب کاربری</h2>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <MenuLink to="/account" icon="👤" label="ویرایش اطلاعات حساب" />
                <MenuLink to="/settings/password" icon="🔒" label="تغییر رمز عبور" />

                {confirmLogout ? (
                  <div className="flex items-center justify-between gap-3 bg-red-50 px-4 py-3">
                    <p className="text-sm font-medium text-red-700">از حساب خارج می‌شوید؟</p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmLogout(false)}
                        disabled={loggingOut}
                        className="h-9 rounded-lg px-3 text-sm font-semibold text-gray-600 hover:bg-white"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        disabled={loggingOut}
                        autoFocus
                        className="flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-70"
                      >
                        {loggingOut && (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        )}
                        خروج
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmLogout(true)}
                    className="flex h-14 w-full items-center gap-3 px-4 text-right text-red-600 hover:bg-red-50 focus:outline-none focus-visible:bg-red-50"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-base" aria-hidden="true">
                      ↪
                    </span>
                    <span className="font-medium">خروج از حساب</span>
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

const TONES = {
  amber: { box: "bg-amber-50 ring-amber-100", num: "text-amber-700" },
  green: { box: "bg-green-50 ring-green-100", num: "text-green-700" },
  red: { box: "bg-red-50 ring-red-100", num: "text-red-700" },
};

// یک بخش آماری: عنوان با یک لینک کنار آن و سه کاشی عددی.
// statHref (اختیاری): مقصد هر کاشی؛ بدون آن کاشی‌ها فقط عددند.
// اگر همهٔ عددها صفر باشند، به‌جای سه صفر یک دعوت به اقدام نمایش داده می‌شود.
function StatSection({ title, stats, statHref, action, empty, children }) {
  const total = stats.reduce((sum, s) => sum + s.value, 0);

  return (
    <section className="mx-4 mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {total > 0 && action && (
          <Link to={action.href} className="rounded-lg px-2 py-1 text-sm font-semibold text-blue-600 hover:bg-blue-50">
            {action.text}
          </Link>
        )}
      </div>

      {total === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4">
          <p className="text-sm text-gray-500">{empty.text}</p>
          <Link
            to={empty.href}
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {empty.cta}
          </Link>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2">
            {stats.map((s) => {
              const tone = TONES[s.tone];
              const isZero = s.value === 0;
              const className = `flex h-full flex-col items-center justify-center rounded-2xl px-2 py-4 text-center ring-1 ${
                isZero ? "bg-white ring-gray-200" : tone.box
              }`;
              const content = (
                <>
                  {/* عدد صفر خاکستری می‌شود تا چشم روی عددهای مهم بماند */}
                  <span className={`text-2xl font-bold ${isZero ? "text-gray-300" : tone.num}`}>
                    {toFaNumber(s.value)}
                  </span>
                  <span className="mt-1 text-xs text-gray-600">{s.label}</span>
                </>
              );
              return (
                <li key={s.key}>
                  {statHref ? (
                    <Link
                      to={statHref(s.key)}
                      className={`${className} transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={className}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {children}
        </>
      )}
    </section>
  );
}

function MenuLink({ to, icon, label }) {
  return (
    <Link
      to={to}
      className="flex h-14 items-center gap-3 px-4 text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-base" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 font-medium">{label}</span>
      <span className="text-gray-400" aria-hidden="true">
        ‹
      </span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-4" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="h-40 rounded-3xl bg-gray-300" />
      <div className="mt-4 h-20 rounded-2xl bg-gray-200" />
      {[0, 1].map((i) => (
        <div key={i} className="mt-6">
          <div className="mb-2 h-5 w-28 rounded bg-gray-200" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-20 rounded-2xl bg-gray-200" />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-6 h-44 rounded-2xl bg-gray-200" />
    </div>
  );
}
