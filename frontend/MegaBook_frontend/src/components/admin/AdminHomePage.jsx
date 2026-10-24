import { useEffect, useState } from "react";
import AdminShell from "./AdminShell";
import { formatDate, timeAgo, toFaNumber, wait } from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — «کارهای امروز» (صفحهٔ اول)
//
// این صفحه نمودار ندارد. کارش این است که بگوید چه کاری منتظر ادمین است و
// چیزی عقب افتاده یا نه. هر کارت تعداد کارهای منتظر یک صف و «قدیمی‌ترین مورد»
// آن را نشان می‌دهد و به همان صف لینک می‌شود. کارتی که مورد منتظر ندارد
// کم‌رنگ می‌شود تا چشم روی کارهای واقعی بماند.
//
// زیر کارت‌ها یک خلاصهٔ مالی کوتاه است. همهٔ عددها از دفتر تراکنش‌ها حساب
// می‌شوند و هیچ‌کدام ذخیره نمی‌شود.
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند
// GET /api/admin/summary/
//   queues: برای هر صف { count, oldest_at }   (oldest_at با Min("created_at"))
//   finance:
//     sales_today / sales_month        ← تعداد سفارش‌های موفق
//     gross_today / gross_month        ← جمع مبلغ سفارش‌ها
//     commission_today / commission_month ← جمع ردیف‌های commission دفتر (سهم مگابوک)
//     pending_withdrawals_total        ← جمع برداشت‌های در انتظار (پولی که باید واریز شود)
//   «امروز» و «این ماه» با تقویم شمسی و ساعت تهران حساب شوند؛ مرز روز را
//   سرور تعیین کند، نه مرورگر ادمین.
// ═════════════════════════════════════════════════════════════
const HOUR = 60 * 60 * 1000;
const t = (h) => new Date(Date.now() - h * HOUR).toISOString();

async function fetchSummary() {
  await wait(500);
  return {
    queues: {
      books: { count: 4, oldest_at: t(30) },
      requests: { count: 3, oldest_at: t(50) },
      conversations: { count: 5, oldest_at: t(49) },
      topups: { count: 2, oldest_at: t(25) },
      withdrawals: { count: 1, oldest_at: t(18) },
      reviews: { count: 2, oldest_at: t(5) },
    },
    finance: {
      sales_today: 6, gross_today: 742000, commission_today: 168000,
      sales_month: 94, gross_month: 11850000, commission_month: 2730000,
      pending_withdrawals_total: 250000,
    },
  };
}

// اگر قدیمی‌ترین مورد یک صف بیشتر از این ساعت منتظر مانده، کارتش هشدار می‌گیرد
const OVERDUE_HOURS = 24;

const QUEUE_CARDS = [
  { key: "books", title: "کتاب‌های منتظر بررسی", icon: "📚", href: "/admin/books", unit: "کتاب" },
  { key: "conversations", title: "منتظر پاسخ ما", icon: "💬", href: "/admin/conversations", unit: "گفتگو" },
  { key: "topups", title: "شارژ کارت‌به‌کارت", icon: "🧾", href: "/admin/wallet?tab=topups", unit: "درخواست" },
  { key: "withdrawals", title: "برداشت‌ها", icon: "🏦", href: "/admin/wallet?tab=withdrawals", unit: "درخواست" },
  { key: "requests", title: "درخواست‌های بررسی‌نشده", icon: "📮", href: "/admin/requests", unit: "درخواست" },
  { key: "reviews", title: "نظرهای تازه", icon: "⭐", href: "/admin/reviews", unit: "نظر" },
];

export default function AdminHomePage() {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchSummary()
        .then((d) => !cancelled && (setData(d), setState("ready")))
        .catch(() => !cancelled && setState((s) => (s === "ready" ? s : "error")));
    load();
    // هر دقیقه، فقط وقتی تب دیده می‌شود
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const totalWaiting = data ? Object.values(data.queues).reduce((s, q) => s + q.count, 0) : 0;

  return (
    <AdminShell active="home">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 lg:p-8">
          <header className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">کارهای امروز</h1>
              <p className="mt-1 text-sm text-gray-500">{formatDate(new Date().toISOString())}</p>
            </div>
            {state === "ready" && (
              <p className="text-sm text-gray-600" aria-live="polite">
                {totalWaiting ? `${toFaNumber(totalWaiting)} کار منتظر شماست.` : "🎉 کاری منتظر نیست."}
              </p>
            )}
          </header>

          {state === "loading" && (
            <div className="mt-6 grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              {QUEUE_CARDS.map((c) => <div key={c.key} className="h-32 rounded-2xl bg-gray-200" />)}
            </div>
          )}
          {state === "error" && <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">خلاصه دریافت نشد. صفحه را دوباره بارگذاری کنید.</p>}

          {state === "ready" && (
            <>
              {/* ── صف‌ها ── */}
              <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {QUEUE_CARDS.map((c) => {
                  const q = data.queues[c.key];
                  const idle = q.count === 0;
                  const overdue = !idle && Date.now() - new Date(q.oldest_at).getTime() > OVERDUE_HOURS * HOUR;
                  return (
                    <li key={c.key}>
                      <a
                        href={c.href}
                        className={`flex h-full flex-col rounded-2xl border p-4 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 ${
                          idle ? "border-gray-200 bg-white/60 text-gray-400" : overdue ? "border-amber-300 bg-amber-50 hover:bg-amber-100" : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span aria-hidden="true">{c.icon}</span>
                          <span className={idle ? "" : "text-gray-700"}>{c.title}</span>
                        </span>
                        <span className={`mt-3 text-3xl font-bold ${idle ? "text-gray-300" : "text-gray-900"}`}>
                          {toFaNumber(q.count)} <span className="text-sm font-normal text-gray-500">{c.unit}</span>
                        </span>
                        <span className={`mt-1 text-xs ${overdue ? "font-semibold text-amber-800" : "text-gray-500"}`}>
                          {idle ? "موردی منتظر نیست" : `قدیمی‌ترین: ${timeAgo(q.oldest_at)}`}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>

              {/* ── خلاصهٔ مالی ── */}
              <section className="mt-8">
                <h2 className="text-base font-bold text-gray-900">فروش</h2>
                <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-2 text-right font-medium" scope="col"><span className="sr-only">بازه</span></th>
                        <th className="px-4 py-2 text-right font-medium" scope="col">تعداد سفارش</th>
                        <th className="px-4 py-2 text-right font-medium" scope="col">جمع فروش</th>
                        <th className="px-4 py-2 text-right font-medium" scope="col">سهم مگابوک</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[
                        ["امروز", data.finance.sales_today, data.finance.gross_today, data.finance.commission_today],
                        ["این ماه", data.finance.sales_month, data.finance.gross_month, data.finance.commission_month],
                      ].map(([label, n, gross, mine]) => (
                        <tr key={label}>
                          <th scope="row" className="px-4 py-3 text-right font-semibold text-gray-700">{label}</th>
                          <td className="px-4 py-3 text-gray-900">{toFaNumber(n)}</td>
                          <td className="px-4 py-3 text-gray-900">{toFaNumber(gross)} تومان</td>
                          <td className="px-4 py-3 font-semibold text-blue-700">{toFaNumber(mine)} تومان</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.finance.pending_withdrawals_total > 0 && (
                  <a href="/admin/wallet?tab=withdrawals" className="mt-3 inline-block text-sm text-gray-600 hover:text-blue-700">
                    {toFaNumber(data.finance.pending_withdrawals_total)} تومان برداشت در انتظار واریز است ←
                  </a>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
