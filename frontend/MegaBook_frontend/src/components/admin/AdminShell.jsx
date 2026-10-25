import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCounts } from "../../api/admin";
import { ADMIN_COUNTS_EVENT, toFaNumber } from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// قاب مشترک همهٔ صفحه‌های ادمین: منوی کناری + محتوای صفحه.
// روی دسکتاپ منو ستونی سمت راست است؛ روی موبایل یک نوار افقی بالای صفحه.
//
// عددهای کنار منو («کار منتظر» هر بخش) را خود قاب می‌گیرد، نه صفحه‌ها
// (GET /admin-api/counts/؛ هر عدد یک COUNT در سرور، هیچ‌کدام ذخیره نمی‌شود):
//   • هر ۳۰ ثانیه (فقط وقتی تب دیده می‌شود)
//   • و هر وقت صفحه‌ای رویداد megabook:admin-counts-changed بفرستد
//     (مثلاً بعد از تأیید یک کتاب، تا عدد «بررسی کتاب‌ها» همان لحظه کم شود)
//
// دسترسی: این صفحه‌ها داخل StaffRoute هستند (App.jsx). ولی محافظت اصلی در بکند
// است: هر endpoint ادمین برای غیرادمین 404 برمی‌گرداند. پنهان کردن منو امنیت نیست.
// ═════════════════════════════════════════════════════════════

export const ADMIN_NAV = [
  { key: "home", label: "کارهای امروز", icon: "🏠", href: "/admin" },
  { key: "books", label: "بررسی کتاب‌ها", icon: "📚", href: "/admin/books" },
  { key: "requests", label: "درخواست‌ها", icon: "📮", href: "/admin/requests" },
  { key: "conversations", label: "گفتگوها", icon: "💬", href: "/admin/conversations" },
  { key: "wallet", label: "کیف پول", icon: "👛", href: "/admin/wallet" },
  { key: "reviews", label: "نظرها", icon: "⭐", href: "/admin/reviews" },
  { key: "users", label: "کاربران", icon: "👥", href: "/admin/users" },
  { key: "taxonomy", label: "دسته‌ها و برچسب‌ها", icon: "🏷️", href: "/admin/taxonomy" },
  // همان فرم بارگذاری کاربران؛ برای ادمین کتاب مستقیم تأیید می‌شود (تصمیم ۳.۱۲)
  { key: "add-book", label: "افزودن کتاب", icon: "＋", href: "/books/new" },
];

export default function AdminShell({ active, children }) {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getCounts()
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
          {/* Below lg the way back to the store is here (the link at the menu's foot is lg+ only) */}
          <Link
            to="/"
            className="ms-auto flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 lg:hidden"
          >
            <span aria-hidden="true">🏪</span>
            بازگشت به فروشگاه
          </Link>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-4">
          {ADMIN_NAV.map((item) => {
            const isActive = item.key === active;
            const badge = counts[item.key];
            return (
              <li key={item.key} className="shrink-0">
                <Link
                  to={item.href}
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
                </Link>
              </li>
            );
          })}
        </ul>
        {/* ادمین هم کاربر است و ممکن است بخواهد فروشگاه را ببیند */}
        <Link to="/" className="hidden px-5 pb-5 text-xs text-gray-400 hover:text-white lg:block">
          → بازگشت به فروشگاه
        </Link>
      </nav>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
