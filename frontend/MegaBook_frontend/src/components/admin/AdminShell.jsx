import { useEffect, useState } from "react";
import { ADMIN_COUNTS_EVENT, toFaNumber, wait } from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// قاب مشترک همهٔ صفحه‌های ادمین: منوی کناری + محتوای صفحه.
// روی دسکتاپ منو ستونی سمت راست است؛ روی موبایل یک نوار افقی بالای صفحه.
//
// عددهای کنار منو («کار منتظر» هر بخش) را خود قاب می‌گیرد، نه صفحه‌ها:
//   • هر ۳۰ ثانیه (فقط وقتی تب دیده می‌شود)
//   • و هر وقت صفحه‌ای رویداد megabook:admin-counts-changed بفرستد
//     (مثلاً بعد از تأیید یک کتاب، تا عدد «بررسی کتاب‌ها» همان لحظه کم شود)
//
// 🔌 دسترسی: این قاب باید داخل یک route محافظت‌شده باشد که فقط is_staff را
// راه می‌دهد (مثل ProtectedRoute، با شرط ادمین). ولی محافظت اصلی در بکند است:
// هر endpoint ادمین برای غیرادمین 404 برمی‌گرداند. پنهان کردن منو در فرانت
// امنیت نیست، فقط ظاهر است.
// ═════════════════════════════════════════════════════════════

// GET /api/admin/counts/
//   const res = await axios.get("/api/admin/counts/"); return res.data;
// هر عدد با یک کوئری COUNT ساده حساب می‌شود و هیچ‌کدام ذخیره نمی‌شود.
async function fetchCounts() {
  await wait(250);
  return {
    books: 4, // کتاب‌های در انتظار بررسی
    requests: 3, // درخواست‌های بازی که هنوز ادمینی نگاهشان نکرده
    conversations: 5, // گفتگوهایی که آخرین پیامشان از کاربر است
    wallet: 3, // شارژ کارت‌به‌کارت + برداشت در انتظار
    reviews: 2, // نظرهای متن‌دار «جدید»
  };
}

export const ADMIN_NAV = [
  { key: "home", label: "کارهای امروز", icon: "🏠", href: "/admin" },
  { key: "books", label: "بررسی کتاب‌ها", icon: "📚", href: "/admin/books" },
  { key: "requests", label: "درخواست‌ها", icon: "📮", href: "/admin/requests" },
  { key: "conversations", label: "گفتگوها", icon: "💬", href: "/admin/conversations" },
  { key: "wallet", label: "کیف پول", icon: "👛", href: "/admin/wallet" },
  { key: "reviews", label: "نظرها", icon: "⭐", href: "/admin/reviews" },
  { key: "users", label: "کاربران", icon: "👥", href: "/admin/users" },
  // همان فرم بارگذاری کاربران؛ برای ادمین کتاب مستقیم تأیید می‌شود (تصمیم ۳.۱۲)
  { key: "add-book", label: "افزودن کتاب", icon: "＋", href: "/upload" },
];

// 🔌 با react-router، <a> ها را <NavLink> کنید تا صفحه بدون بارگذاری عوض شود
export default function AdminShell({ active, children }) {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchCounts()
        .then((c) => !cancelled && setCounts(c))
        .catch(() => {});

    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    window.addEventListener(ADMIN_COUNTS_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(ADMIN_COUNTS_EVENT, load);
    };
  }, []);

  return (
    <div dir="rtl" className="flex h-dvh flex-col bg-gray-100 lg:flex-row">
      <nav aria-label="منوی ادمین" className="shrink-0 bg-gray-900 text-gray-300 lg:flex lg:w-56 lg:flex-col">
        <div className="flex h-14 items-center gap-2 px-4 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold" aria-hidden="true">م</span>
          <span className="font-bold">مدیریت مگابوک</span>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-4">
          {ADMIN_NAV.map((item) => {
            const isActive = item.key === active;
            const badge = counts[item.key];
            return (
              <li key={item.key} className="shrink-0">
                <a
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                    isActive ? "bg-white/10 font-semibold text-white" : "hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span className="whitespace-nowrap">{item.label}</span>
                  {badge > 0 && (
                    <span className="mr-auto rounded-full bg-amber-400 px-1.5 text-xs font-bold text-gray-900" aria-label={`${toFaNumber(badge)} مورد منتظر`}>
                      {toFaNumber(badge)}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
        {/* 🔌 لینک برگشت به سایت؛ ادمین هم کاربر است و ممکن است بخواهد فروشگاه را ببیند */}
        <a href="/" className="hidden px-5 pb-5 text-xs text-gray-400 hover:text-white lg:block">
          → بازگشت به فروشگاه
        </a>
      </nav>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
