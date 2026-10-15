import { useEffect, useState } from "react";
// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند: src/api/wallet.js
//
// کیف پول یک «دفتر تراکنش» (ledger) است: هیچ ستون موجودی‌ای وجود ندارد.
// هر بار که پول وارد یا خارج می‌شود، یک ردیف جدید اضافه می‌شود و هیچ
// ردیفی ویرایش یا حذف نمی‌شود. موجودی = جمع amountهای همهٔ ردیف‌ها، که
// بکند حساب می‌کند. amount علامت‌دار است: واریز مثبت، برداشت منفی.
// ═════════════════════════════════════════════════════════════
import {
  createTopupRequest,
  createWithdrawal,
  getTopupRequests,
  getTransactions,
  getWallet,
  getWithdrawals,
  startTopup,
} from "../api/wallet";

// هر فیلتر صفحه؛ فیلتر سمت سرور انجام می‌شود (?type=)، نه در فرانت، چون فرانت
// فقط یک صفحه از تراکنش‌ها را دارد و فیلتر کردن همان یک صفحه نتیجهٔ ناقص می‌دهد.
// «برداشت» برگشت برداشت‌های ردشده را هم نشان می‌دهد.
const FILTERS = [
  { key: "all", label: "همه" },
  { key: "purchase", label: "خرید" },
  { key: "sale_income", label: "درآمد فروش" },
  { key: "topup", label: "شارژ" },
  { key: "withdrawal", label: "برداشت" },
];

// ظاهر و متن هر نوع تراکنش. اگر نوع جدیدی به مدل اضافه شد، اینجا هم اضافه شود.
const TYPE_META = {
  purchase: { label: "خرید کتاب", icon: "📕", circle: "bg-gray-100" },
  sale_income: { label: "سهم شما از فروش", icon: "💰", circle: "bg-green-50" },
  withdrawal: { label: "برداشت به حساب بانکی", icon: "🏦", circle: "bg-amber-50" },
  withdrawal_reversal: { label: "برگشت برداشت ردشده", icon: "↩️", circle: "bg-amber-50" },
  // تراکنش جبرانی: اگر ادمین اشتباهی را اصلاح کند، ردیف قبلی عوض نمی‌شود؛
  // یک ردیف «اصلاح» با مبلغ مخالف اضافه می‌شود.
  adjustment: { label: "اصلاح توسط پشتیبانی", icon: "🛠️", circle: "bg-gray-100" },
  commission: { label: "کمیسیون", icon: "🏷️", circle: "bg-gray-100" },
};
// شارژ یک نوع است؛ برچسبش از منبع آن (source) می‌آید
const TOPUP_META = {
  gateway: { label: "شارژ آنلاین", icon: "💳", circle: "bg-blue-50" },
  card_to_card: { label: "شارژ کارت‌به‌کارت", icon: "🧾", circle: "bg-blue-50" },
};

// 🔌 راه ارتباط با پشتیبانی هنوز تصمیم‌گیری نشده (چت داخل سایت یا تلگرام).
// فعلاً به یک صفحهٔ موقت لینک می‌شود.
const SUPPORT_HREF = "/support";

// مبلغ‌های پیشنهادی؛ کاربر مبلغ دلخواه خودش را هم می‌تواند بنویسد. حداقل و حداکثری نیست.
const PRESETS = [50000, 100000, 200000];

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════

const toFaNumber = (n) => Number(n).toLocaleString("fa-IR");

// ارقام فارسی و عربی را لاتین می‌کند و هر چیز غیرعددی (مثل جداکنندهٔ ٬) را حذف می‌کند
function toLatinDigits(text) {
  return text
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

// تاریخ شمسی: fa-IR به‌طور پیش‌فرض تقویم شمسی دارد. ← «۲۲ مهر، ۱۱:۱۵»
const formatDateTime = (iso) =>
  new Date(iso).toLocaleString("fa-IR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// مبلغ با علامت: «+۹۶٬۰۰۰» یا «−۱۸۵٬۰۰۰»
// از «−» (منهای ریاضی) استفاده می‌کنیم که از خط تیره خواناتر است.
const formatSigned = (amount) => `${amount > 0 ? "+" : "−"}${toFaNumber(Math.abs(amount))}`;

// 6037991234567890 → «6037 9912 3456 7890»
const groupCard = (digits) => digits.replace(/(\d{4})(?=\d)/g, "$1 ");

// The value for <input type="datetime-local"> for "now" in the user's local time
function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// DRF errors { field: ["پیام", ...] } → { field: "پیام پیام" }; general errors under "form"
function toErrors(data) {
  const result = {};
  if (!data || typeof data !== "object") return result;
  Object.entries(data).forEach(([key, value]) => {
    const text = Array.isArray(value) ? value.join(" ") : String(value);
    const target = key === "non_field_errors" || key === "detail" ? "form" : key;
    result[target] = result[target] ? `${result[target]} ${text}` : text;
  });
  return result;
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function WalletPage({ onBack }) {
  const [balance, setBalance] = useState(null);
  // کارت مگابوک برای کارت‌به‌کارت (از بکند)، یا null اگر هنوز تنظیم نشده
  const [topupCard, setTopupCard] = useState(null);
  const [walletStatus, setWalletStatus] = useState("loading"); // loading | ready | error

  const [filter, setFilter] = useState("all");
  const [transactions, setTransactions] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [listStatus, setListStatus] = useState("loading"); // loading | ready | more | error
  // هر بار این عدد یکی زیاد شود، لیست از صفحهٔ اول دوباره گرفته می‌شود
  // (برای «تلاش دوباره» و بعد از هر تغییر موجودی، وقتی فیلتر عوض نشده است)
  const [reloadKey, setReloadKey] = useState(0);

  // درخواست‌های شارژ کارت‌به‌کارت و برداشت من (هر دو با هم، جدیدترین اول)
  const [requests, setRequests] = useState([]);
  const [requestsKey, setRequestsKey] = useState(0);

  // مبلغ شارژ به‌صورت رشته‌ای از ارقام لاتین نگه داشته می‌شود («50000»)
  // و فقط هنگام نمایش به شکل «۵۰٬۰۰۰» درمی‌آید.
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  const [sheet, setSheet] = useState(null); // null | "withdraw" | "manual"
  const [toast, setToast] = useState(null); // { text, tone }

  // ── بارگذاری موجودی ──
  async function loadWallet() {
    setWalletStatus("loading");
    try {
      const data = await getWallet();
      setBalance(data.balance);
      setTopupCard(data.topup_card);
      setWalletStatus("ready");
    } catch {
      setWalletStatus("error");
    }
  }

  // بعد از هر کاری که موجودی را عوض می‌کند: موجودی، تراکنش‌ها و درخواست‌ها از سرور.
  // خودمان عدد را اضافه یا کم نمی‌کنیم؛ منبع حقیقت همیشه بکند است.
  function refreshAll() {
    loadWallet();
    setReloadKey((k) => k + 1);
    setRequestsKey((k) => k + 1);
  }

  // ── بارگذاری صفحهٔ اول تراکنش‌ها؛ با عوض شدن فیلتر یا reloadKey دوباره اجرا می‌شود ──
  useEffect(() => {
    let cancelled = false;
    setListStatus("loading");
    setTransactions([]);

    getTransactions({ filter, page: 1 })
      .then((data) => {
        if (cancelled) return;
        setTransactions(data.results);
        setNextPage(data.next ? 2 : null);
        setListStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setListStatus("error");
      });

    // اگر کاربر سریع بین فیلترها جابه‌جا شود، پاسخ فیلتر قبلی نادیده گرفته می‌شود
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey]);

  // ── درخواست‌های من ──
  useEffect(() => {
    let cancelled = false;
    Promise.all([getTopupRequests(), getWithdrawals()])
      .then(([topups, withdrawals]) => {
        if (cancelled) return;
        const merged = [
          ...topups.results.map((r) => ({ ...r, kind: "topup" })),
          ...withdrawals.results.map((r) => ({ ...r, kind: "withdrawal" })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setRequests(merged);
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [requestsKey]);

  useEffect(() => {
    loadWallet();

    // 🔌 بعد از برگشت از درگاه واقعی، بکند کاربر را با ?topup=success یا ?topup=failed
    // به این صفحه برمی‌گرداند. اینجا نتیجه را نشان می‌دهیم و پارامتر را از آدرس
    // پاک می‌کنیم تا با رفرش صفحه پیام دوباره نیاید.
    const result = new URLSearchParams(window.location.search).get("topup");
    if (result) {
      showToast(
        result === "success"
          ? { text: "کیف پول شارژ شد.", tone: "green" }
          : { text: "پرداخت انجام نشد. اگر مبلغی کسر شده، تا ۷۲ ساعت به حسابتان برمی‌گردد.", tone: "red" }
      );
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function handleLoadMore() {
    setListStatus("more");
    try {
      const data = await getTransactions({ filter, page: nextPage });
      // صفحهٔ جدید به انتهای لیست اضافه می‌شود، جایگزینش نمی‌شود
      setTransactions((prev) => [...prev, ...data.results]);
      setNextPage(data.next ? nextPage + 1 : null);
      setListStatus("ready");
    } catch {
      setListStatus("ready");
      showToast({ text: "بارگذاری تراکنش‌های بیشتر ناموفق بود.", tone: "red" });
    }
  }

  function showToast(t) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  function handleAmountChange(e) {
    // حداکثر ۱۲ رقم، تا عدد بی‌معنی بزرگ تایپ نشود
    setAmount(toLatinDigits(e.target.value).slice(0, 12));
    setAmountError("");
  }

  // نکتهٔ امنیتی: فرانت هرگز به بکند نمی‌گوید «پرداخت انجام شد». با درگاه واقعی،
  // بکند خودش از درگاه می‌پرسد (verify). فعلاً درگاه ماک است و فقط در حالت توسعه کار می‌کند.
  async function handleTopup() {
    const value = Number(amount);
    if (!value) return setAmountError("مبلغ شارژ را وارد کنید.");

    setTopupLoading(true);
    try {
      const result = await startTopup(value);
      // 🔌 با درگاه واقعی: if (result.status === "redirect") window.location.href = result.payment_url;
      if (result.status === "paid") {
        setAmount("");
        setFilter("all");
        refreshAll();
        showToast({ text: `کیف پول ${toFaNumber(value)} تومان شارژ شد.`, tone: "green" });
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 400) {
        setAmountError(toErrors(err.response.data).amount || "مبلغ معتبر نیست.");
      } else if (status === 404) {
        // The mock gateway exists only in development; no real gateway yet
        showToast({ text: "پرداخت آنلاین هنوز فعال نیست. از شارژ کارت‌به‌کارت استفاده کنید.", tone: "red" });
      } else {
        showToast({ text: "اتصال به درگاه پرداخت برقرار نشد. دوباره تلاش کنید.", tone: "red" });
      }
    } finally {
      setTopupLoading(false);
    }
  }

  const activeFilter = FILTERS.find((f) => f.key === filter);

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md">
        {/* ═══ نوار بالا ═══ */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <button
            type="button"
            onClick={onBack ?? (() => window.history.back())}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="text-base font-bold text-gray-900">کیف پول</h1>
          {/* 🔌 صفحهٔ اعلان‌ها هنوز ساخته نشده: <Link to="/notifications"> */}
          <a
            href="/notifications"
            aria-label="اعلان‌ها"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            🔔
          </a>
        </header>

        {/* ═══ کارت موجودی ═══ */}
        <section className="relative mx-4 mt-4 overflow-hidden rounded-3xl bg-blue-600 p-6 text-white shadow-lg shadow-blue-600/20">
          {/* همان دایره‌های تزئینی سربرگ صفحه‌های ورود و ثبت‌نام */}
          <div className="absolute -left-6 top-4 h-24 w-24 rounded-full border-4 border-white/10" />
          <div className="absolute left-16 -top-8 h-20 w-20 rounded-full border-4 border-white/10" />

          <div className="relative">
            <p className="text-sm text-blue-100">موجودی کیف پول</p>

            {walletStatus === "loading" && (
              <div className="mt-2 h-10 w-44 animate-pulse rounded-lg bg-white/20" aria-label="در حال بارگذاری" />
            )}
            {walletStatus === "error" && (
              <div className="mt-2 flex items-center gap-3">
                <p className="text-sm">موجودی دریافت نشد.</p>
                <button
                  type="button"
                  onClick={loadWallet}
                  className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25"
                >
                  تلاش دوباره
                </button>
              </div>
            )}
            {walletStatus === "ready" && (
              <p className="mt-1 text-4xl font-bold tracking-tight">
                {toFaNumber(balance)} <span className="text-base font-medium text-blue-100">تومان</span>
              </p>
            )}

            <button
              type="button"
              onClick={() => setSheet("withdraw")}
              disabled={walletStatus !== "ready" || balance === 0}
              className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">🏦</span>
              برداشت موجودی
            </button>
          </div>
        </section>

        {/* ═══ شارژ کیف پول ═══ */}
        <section className="mx-4 mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">شارژ کیف پول</h2>

          {/* مبلغ‌های پیشنهادی */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {PRESETS.map((p) => {
              const selected = Number(amount) === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setAmount(String(p));
                    setAmountError("");
                  }}
                  aria-pressed={selected}
                  className={`h-11 rounded-xl border text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
                    selected
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {toFaNumber(p)}
                </button>
              );
            })}
          </div>

          {/* مبلغ دلخواه */}
          <label htmlFor="amount" className="mb-1.5 mt-4 block text-sm text-gray-600">
            یا مبلغ دلخواه
          </label>
          <div className="relative">
            <input
              id="amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amount ? toFaNumber(amount) : ""}
              onChange={handleAmountChange}
              aria-invalid={Boolean(amountError)}
              aria-describedby={amountError ? "amount-error" : undefined}
              placeholder="مثلاً ۷۵٬۰۰۰"
              className={`h-12 w-full rounded-xl border bg-white pl-16 pr-4 text-lg font-semibold text-gray-900 placeholder:text-base placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                amountError ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-blue-600"
              }`}
            />
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              تومان
            </span>
          </div>
          {amountError && (
            <p id="amount-error" className="mt-1.5 text-xs text-red-600">
              {amountError}
            </p>
          )}

          <button
            type="button"
            onClick={handleTopup}
            disabled={topupLoading || !amount}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
          >
            {topupLoading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                در حال اتصال به درگاه…
              </>
            ) : (
              <>
                <span aria-hidden="true">💳</span>
                {amount ? `پرداخت ${toFaNumber(amount)} تومان` : "پرداخت آنلاین"}
              </>
            )}
          </button>

          {/* روش دوم: کارت‌به‌کارت به کارت مگابوک و بررسی توسط ادمین */}
          <button
            type="button"
            onClick={() => setSheet("manual")}
            className="mt-2 flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-blue-600 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            شارژ با کارت‌به‌کارت
          </button>
        </section>

        {/* ═══ درخواست‌های من (شارژ کارت‌به‌کارت و برداشت) ═══ */}
        {requests.length > 0 && (
          <section className="mt-6">
            <h2 className="px-4 text-lg font-bold text-gray-900">درخواست‌های من</h2>
            <ul className="mx-4 mt-3 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {requests.map((r) => (
                <RequestRow key={`${r.kind}-${r.id}`} request={r} />
              ))}
            </ul>
          </section>
        )}

        {/* ═══ تراکنش‌ها ═══ */}
        <section className="mt-6">
          <h2 className="px-4 text-lg font-bold text-gray-900">تراکنش‌ها</h2>

          {/* فیلترها؛ روی صفحهٔ باریک افقی اسکرول می‌شوند */}
          <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="نوع تراکنش">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 ${
                  filter === f.key
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="mx-4 mt-3">
            {listStatus === "loading" && <ListSkeleton />}

            {listStatus === "error" && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <span>تراکنش‌ها دریافت نشد.</span>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="shrink-0 rounded-lg px-3 py-1.5 font-semibold hover:bg-red-100"
                >
                  تلاش دوباره
                </button>
              </div>
            )}

            {(listStatus === "ready" || listStatus === "more") && transactions.length === 0 && (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
                <span className="text-3xl" aria-hidden="true">🧾</span>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  {filter === "all"
                    ? "هنوز تراکنشی ندارید. با شارژ کیف پول اولین کتابتان را بخرید."
                    : `تراکنشی از نوع «${activeFilter.label}» ندارید.`}
                </p>
              </div>
            )}

            {transactions.length > 0 && (
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                {transactions.map((t) => (
                  <TransactionRow key={t.id} tx={t} />
                ))}
              </ul>
            )}

            {nextPage && listStatus !== "loading" && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={listStatus === "more"}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-sm font-semibold text-gray-600 hover:bg-white disabled:cursor-wait"
              >
                {listStatus === "more" && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                )}
                {listStatus === "more" ? "در حال بارگذاری…" : "نمایش تراکنش‌های قبلی"}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* ═══ پنل‌های پایین صفحه ═══ */}
      {sheet === "withdraw" && (
        <Sheet title="برداشت موجودی" onClose={() => setSheet(null)}>
          <WithdrawForm
            balance={balance}
            onDone={() => {
              setSheet(null);
              refreshAll();
              showToast({ text: "درخواست برداشت ثبت شد. مبلغ پس از بررسی به کارت شما واریز می‌شود.", tone: "green" });
            }}
          />
        </Sheet>
      )}

      {sheet === "manual" && (
        <Sheet title="شارژ با کارت‌به‌کارت" onClose={() => setSheet(null)}>
          <ManualTopupForm
            card={topupCard}
            onDone={() => {
              setSheet(null);
              setRequestsKey((k) => k + 1);
              showToast({ text: "درخواست شارژ ثبت شد. پس از بررسی، کیف پولتان شارژ می‌شود.", tone: "green" });
            }}
          />
        </Sheet>
      )}

      {/* ═══ پیام کوتاه ═══ */}
      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-6 z-40 mx-auto max-w-sm rounded-2xl px-4 py-3 text-center text-sm text-white shadow-lg ${
            toast.tone === "red" ? "bg-red-600" : "bg-gray-900"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// فرم‌ها
// ═════════════════════════════════════════════════════════════

const inputBase =
  "h-12 w-full rounded-xl border bg-white px-4 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30";
const inputClass = (error) =>
  `${inputBase} ${error ? "border-red-400 focus:border-red-500" : "border-gray-300 focus:border-blue-600"}`;

function FieldError({ text }) {
  return text ? <p className="mt-1.5 text-xs text-red-600">{text}</p> : null;
}

function FormError({ text }) {
  return text ? (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
      {text}
    </div>
  ) : null;
}

function SubmitButton({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  );
}

// برداشت: هر مبلغی تا سقف موجودی. مبلغ همین حالا از کیف پول کم می‌شود
// (تا نشود همان پول را خرج کتاب کرد) و اگر درخواست رد شود برمی‌گردد.
function WithdrawForm({ balance, onDone }) {
  const [amount, setAmount] = useState("");
  const [card, setCard] = useState("");
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!Number(amount)) next.amount = "مبلغ برداشت را وارد کنید.";
    else if (balance !== null && Number(amount) > balance) next.amount = "موجودی کیف پول کافی نیست.";
    if (card.length !== 16) next.card_number = "شماره کارت باید ۱۶ رقم باشد.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await createWithdrawal({ amount: Number(amount), card_number: card });
      onDone();
    } catch (err) {
      setErrors(
        err.response?.status === 400
          ? toErrors(err.response.data)
          : { form: "ارتباط با سرور برقرار نشد. دوباره تلاش کنید." }
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <p className="text-sm leading-7 text-gray-600">
        مبلغ همین حالا از کیف پول کم می‌شود و پس از بررسی پشتیبانی به کارت شما واریز می‌شود. اگر
        درخواست رد شود، مبلغ به کیف پول برمی‌گردد. کارت باید به نام خود شما باشد.
      </p>
      <FormError text={errors.form} />

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="withdraw-amount" className="text-sm font-medium text-gray-700">
            مبلغ (تومان)
          </label>
          {balance > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(balance))}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              کل موجودی ({toFaNumber(balance)})
            </button>
          )}
        </div>
        <input
          id="withdraw-amount"
          inputMode="numeric"
          autoComplete="off"
          value={amount ? toFaNumber(amount) : ""}
          onChange={(e) => setAmount(toLatinDigits(e.target.value).slice(0, 12))}
          className={inputClass(errors.amount)}
        />
        <FieldError text={errors.amount} />
      </div>

      <div>
        <label htmlFor="withdraw-card" className="mb-1.5 block text-sm font-medium text-gray-700">
          شماره کارت
        </label>
        <input
          id="withdraw-card"
          dir="ltr"
          inputMode="numeric"
          autoComplete="cc-number"
          value={groupCard(card)}
          onChange={(e) => setCard(toLatinDigits(e.target.value).slice(0, 16))}
          placeholder="6037 9912 3456 7890"
          className={`${inputClass(errors.card_number)} text-left tracking-wider`}
        />
        <FieldError text={errors.card_number} />
      </div>

      <SubmitButton loading={loading}>{loading ? "در حال ثبت…" : "ثبت درخواست برداشت"}</SubmitButton>
    </form>
  );
}

// شارژ کارت‌به‌کارت: کاربر بیرون از سایت به کارت مگابوک واریز می‌کند و اینجا گزارشش را
// می‌فرستد؛ ادمین صورت‌حساب بانک را بررسی و تایید یا رد می‌کند.
function ManualTopupForm({ card, onDone }) {
  const [amount, setAmount] = useState("");
  const [tracking, setTracking] = useState("");
  const [depositedAt, setDepositedAt] = useState(localNow);
  const [receipt, setReceipt] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(card.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the number is on screen anyway
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const next = {};
    if (!Number(amount)) next.amount = "مبلغ واریزی را وارد کنید.";
    if (!tracking.trim()) next.tracking_number = "شماره پیگیری واریز را وارد کنید.";
    if (!depositedAt) next.deposited_at = "زمان واریز را وارد کنید.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const data = new FormData();
    data.append("amount", amount);
    data.append("tracking_number", tracking);
    // datetime-local has no time zone; toISOString sends it as UTC, so the server
    // stores the moment the user meant
    data.append("deposited_at", new Date(depositedAt).toISOString());
    if (receipt) data.append("receipt", receipt);

    setLoading(true);
    try {
      await createTopupRequest(data);
      onDone();
    } catch (err) {
      setErrors(
        err.response?.status === 400
          ? toErrors(err.response.data)
          : { form: "ارتباط با سرور برقرار نشد. دوباره تلاش کنید." }
      );
    } finally {
      setLoading(false);
    }
  }

  if (!card) {
    return (
      <>
        <p className="text-sm leading-7 text-gray-600">
          شماره کارت مگابوک هنوز در سایت ثبت نشده است. برای شارژ کارت‌به‌کارت با پشتیبانی تماس بگیرید.
        </p>
        <SupportButton />
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <ol className="list-inside list-decimal space-y-1 text-sm leading-7 text-gray-600">
        <li>مبلغ دلخواه را به کارت زیر کارت‌به‌کارت کنید.</li>
        <li>شماره پیگیری و زمان واریز را اینجا بنویسید.</li>
        <li>پس از بررسی پشتیبانی، کیف پولتان شارژ می‌شود.</li>
      </ol>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3">
        <div>
          <p dir="ltr" className="text-right font-bold tracking-wider text-gray-900">
            {groupCard(card.number)}
          </p>
          {card.holder && <p className="mt-0.5 text-xs text-gray-500">به نام {card.holder}</p>}
        </div>
        <button
          type="button"
          onClick={copyCard}
          className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-blue-600 hover:bg-blue-50"
        >
          {copied ? "کپی شد" : "کپی"}
        </button>
      </div>

      <FormError text={errors.form} />

      <div>
        <label htmlFor="manual-amount" className="mb-1.5 block text-sm font-medium text-gray-700">
          مبلغ واریزی (تومان)
        </label>
        <input
          id="manual-amount"
          inputMode="numeric"
          autoComplete="off"
          value={amount ? toFaNumber(amount) : ""}
          onChange={(e) => setAmount(toLatinDigits(e.target.value).slice(0, 12))}
          className={inputClass(errors.amount)}
        />
        <FieldError text={errors.amount} />
      </div>

      <div>
        <label htmlFor="manual-tracking" className="mb-1.5 block text-sm font-medium text-gray-700">
          شماره پیگیری
        </label>
        <input
          id="manual-tracking"
          dir="ltr"
          autoComplete="off"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          className={`${inputClass(errors.tracking_number)} text-left`}
        />
        <FieldError text={errors.tracking_number} />
      </div>

      <div>
        <label htmlFor="manual-date" className="mb-1.5 block text-sm font-medium text-gray-700">
          زمان واریز
        </label>
        <input
          id="manual-date"
          type="datetime-local"
          dir="ltr"
          value={depositedAt}
          max={localNow()}
          onChange={(e) => setDepositedAt(e.target.value)}
          className={`${inputClass(errors.deposited_at)} text-left`}
        />
        <FieldError text={errors.deposited_at} />
      </div>

      <div>
        <label htmlFor="manual-receipt" className="mb-1.5 block text-sm font-medium text-gray-700">
          تصویر رسید <span className="font-normal text-gray-400">(اختیاری)</span>
        </label>
        <input
          id="manual-receipt"
          type="file"
          accept=".jpg,.jpeg,.png"
          onChange={(e) => setReceipt(e.target.files[0] ?? null)}
          className="block w-full text-sm text-gray-600 file:ml-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700"
        />
        <FieldError text={errors.receipt} />
      </div>

      <SubmitButton loading={loading}>{loading ? "در حال ثبت…" : "ثبت درخواست شارژ"}</SubmitButton>
    </form>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

function TransactionRow({ tx }) {
  const meta =
    (tx.type === "topup" ? TOPUP_META[tx.source] : TYPE_META[tx.type]) ??
    { label: "تراکنش", icon: "•", circle: "bg-gray-100" };
  const isCredit = tx.amount > 0;

  // عنوان سطر: برای خرید و فروش نام کتاب، برای اصلاح توضیح ادمین، برای بقیه برچسب نوع
  let title = meta.label;
  if (tx.type === "purchase" && tx.title) title = tx.title;
  if (tx.type === "sale_income" && tx.title) title = `فروش «${tx.title}»`;

  return (
    <li className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${meta.circle}`} aria-hidden="true">
        {meta.icon}
      </div>

      <div className="min-w-0 flex-1">
        {/* truncate: عنوان بلند با «…» کوتاه می‌شود، به‌جای شکستن چیدمان */}
        <p className="truncate font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 truncate text-xs text-gray-500">
          {formatDateTime(tx.created_at)}
          {(tx.type === "purchase" || tx.type === "sale_income") && <> · {meta.label}</>}
          {tx.type === "adjustment" && tx.title && <> · {tx.title}</>}
        </p>
      </div>

      {/* مبلغ علامت‌دار همیشه dir="ltr" دارد؛ وگرنه در متن راست‌به‌چپ،
          «+» یا «−» به آن طرف عدد می‌پرد (همان مشکل bidi شابک) */}
      <p dir="ltr" className={`shrink-0 font-bold ${isCredit ? "text-green-600" : "text-gray-900"}`}>
        {formatSigned(tx.amount)}
      </p>
    </li>
  );
}

const STATUS_STYLE = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-green-50 text-green-700",
  completed: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
};

function RequestRow({ request: r }) {
  const isTopup = r.kind === "topup";
  // Why it was rejected (or the admin's note on a withdrawal)
  const note = isTopup ? r.rejection_reason : r.admin_note;
  return (
    <li className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">
            {isTopup ? "شارژ کارت‌به‌کارت" : "برداشت"} · {toFaNumber(r.amount)} تومان
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {formatDateTime(r.created_at)}
            {isTopup ? (
              <> · پیگیری <span dir="ltr">{r.tracking_number}</span></>
            ) : (
              <> · کارت <span dir="ltr">{r.card_number}</span></>
            )}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[r.status] ?? ""}`}>
          {r.status_label}
        </span>
      </div>
      {note && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-6 text-gray-600">{note}</p>}
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex animate-pulse items-center gap-3 p-4">
          <div className="h-11 w-11 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-gray-200" />
            <div className="h-3 w-1/3 rounded bg-gray-100" />
          </div>
          <div className="h-4 w-16 rounded bg-gray-200" />
        </li>
      ))}
    </ul>
  );
}

// پنلی که از پایین صفحه بالا می‌آید (bottom sheet)
function Sheet({ title, onClose, children }) {
  // بستن با کلید Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center" dir="rtl">
      {/* پس‌زمینهٔ تیره؛ کلیک رویش پنل را می‌بندد */}
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 pb-8 shadow-xl"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-200" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between">
          <h2 id="sheet-title" className="text-lg font-bold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="بستن"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SupportButton() {
  return (
    // 🔌 مقصد این دکمه بعد از تصمیم دربارهٔ راه پشتیبانی عوض می‌شود:
    //   چت داخل سایت ← <Link to="/support">
    //   تلگرام        ← <a href="https://t.me/...">
    <a
      href={SUPPORT_HREF}
      className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
    >
      <span aria-hidden="true">💬</span>
      تماس با پشتیبانی
    </a>
  );
}
