import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useCart from "../hooks/useCart";
import { formatPrice, toFaNumber } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند: سبد در سرور نگه داشته می‌شود و همهٔ کارها از useCart می‌گذرد
// (src/context/CartProvider.jsx). این صفحه هیچ‌وقت خودش API را صدا نمی‌زند.
//
// هر کتاب در پاسخ سرور یکی از این وضعیت‌ها را دارد:
//   "ok"             ← قابل خرید
//   "price_changed"  ← قیمت از وقتی به سبد اضافه شده عوض شده؛ کاربر باید ببیند و تأیید کند
//   "unavailable"    ← کتاب دیگر در فروشگاه نیست (تأییدش برداشته شده)؛ در جمع حساب نمی‌شود
// کتاب‌هایی که کاربر صاحبشان شده را سرور خودش از سبد برمی‌دارد و در removed گزارش می‌دهد.
// جمع کل (total) را هم سرور با قیمت‌های فعلی حساب می‌کند؛ اینجا چیزی جمع زده نمی‌شود.
// ═════════════════════════════════════════════════════════════

const UNAVAILABLE_MESSAGE = "این کتاب دیگر در فروشگاه موجود نیست و در جمع حساب نمی‌شود.";

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function CartPage({ onBack }) {
  const { cart, refresh, removeFromCart, acknowledgePrices, isPending, checkout } = useCart();
  const navigate = useNavigate();

  // The cart page always shows fresh data: it fetches when it opens, and shows the
  // skeleton until that answer arrives (other pages may use the cached cart).
  // "loading" | "ready" | "error"
  const [pageStatus, setPageStatus] = useState("loading");
  // Owned books the server took out of the cart when this page opened
  const [removedOnOpen, setRemovedOnOpen] = useState([]);
  const [actionError, setActionError] = useState("");
  // The pay button is disabled while the checkout request is in flight (no double submit)
  const paying = isPending("checkout");

  async function load() {
    const data = await refresh();
    if (data) {
      setRemovedOnOpen(data.removed);
      setPageStatus("ready");
    } else {
      setPageStatus("error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    refresh().then((data) => {
      if (cancelled) return;
      if (data) {
        setRemovedOnOpen(data.removed);
        setPageStatus("ready");
      } else {
        setPageStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function handleRemove(bookId) {
    setActionError("");
    const result = await removeFromCart(bookId);
    if (!result.ok && result.message) setActionError(result.message);
  }

  async function handleAcknowledge(bookId) {
    setActionError("");
    const result = await acknowledgePrices(bookId);
    if (!result.ok && result.message) setActionError(result.message);
  }

  async function handlePay() {
    setActionError("");
    const result = await checkout();
    if (result.ok) {
      // Straight to the library. replace: "back" from there skips this (now empty) cart page.
      navigate("/library", {
        replace: true,
        state: { message: `خرید انجام شد؛ ${toFaNumber(result.data.count)} کتاب به کتابخانهٔ شما اضافه شد.` },
      });
      return;
    }
    if (result.code === "busy") return;
    setActionError(result.message);
    // cart_changed: the Provider already shows the cart from the answer (changed items flagged).
    // Owned books it took out are reported like on page open.
    if (result.cart) setRemovedOnOpen(result.cart.removed);
    // insufficient_balance: the balance changed since the cart was loaded (another tab,
    // a withdrawal); refetch so the wallet box shows the shortfall and the top-up link
    if (result.code === "insufficient_balance") refresh();
  }

  if (pageStatus === "loading" || !cart) {
    if (pageStatus === "error") {
      return (
        <PageShell count={0} onBack={onBack}>
          <ErrorState onRetry={load} />
        </PageShell>
      );
    }
    return (
      <PageShell count={0} onBack={onBack}>
        <CartSkeleton />
      </PageShell>
    );
  }

  if (pageStatus === "error") {
    return (
      <PageShell count={cart.count} onBack={onBack}>
        <ErrorState onRetry={load} />
      </PageShell>
    );
  }

  // ── مقادیر مشتق‌شده از پاسخ سرور ──
  const items = cart.items;
  const unavailable = items.filter((i) => i.status === "unavailable");
  const payable = items.filter((i) => i.status !== "unavailable");
  const priceChanged = items.filter((i) => i.status === "price_changed");
  const total = cart.total; // computed by the server, current prices, buyable items only
  const balance = cart.balance;
  const shortage = Math.max(0, total - balance);
  const allFree = payable.length > 0 && total === 0;

  // Pay is possible when nothing is unavailable, every new price has been accepted and
  // the wallet covers the total. The server checks all of this again; this only avoids
  // a request that is sure to fail.
  const readyToPay = payable.length > 0 && unavailable.length === 0 && priceChanged.length === 0 && shortage === 0;
  const canPay = readyToPay && !paying;

  if (items.length === 0) {
    return (
      <PageShell count={0} onBack={onBack}>
        {removedOnOpen.length > 0 && (
          <div className="mx-4 mt-4">
            <RemovedNotice removed={removedOnOpen} />
          </div>
        )}
        <div className="mx-4 mt-8 flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center md:mx-auto md:max-w-md">
          <span className="text-4xl" aria-hidden="true">🛒</span>
          <h2 className="mt-3 text-lg font-bold text-gray-900">سبد خرید خالی است</h2>
          <p className="mt-1 text-sm text-gray-500">کتاب‌هایی را که می‌خواهید به سبد اضافه کنید.</p>
          <Link
            to="/"
            className="mt-6 flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700"
          >
            رفتن به فروشگاه
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell count={cart.count} onBack={onBack}>
      {/* md+: two columns. Right (RTL start): notices and books. Left: wallet, summary and the
          pay button, as a sticky side card. Below md the wrappers are plain blocks. */}
      <div className="pb-36 md:grid md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-6 md:px-6 md:pb-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="md:min-w-0">
        {/* ═══ هشدارهای بالای صفحه ═══ */}
        <div className="mx-4 mt-4 space-y-2 md:mx-0">
          {removedOnOpen.length > 0 && <RemovedNotice removed={removedOnOpen} />}
          {unavailable.length > 0 && (
            <Notice tone="red" icon="⛔">
              {toFaNumber(unavailable.length)} کتاب دیگر در فروشگاه موجود نیست. برای ادامه، آن را از سبد حذف کنید.
            </Notice>
          )}
          {priceChanged.length > 0 && (
            <Notice tone="amber" icon="🏷️">
              قیمت {toFaNumber(priceChanged.length)} کتاب از وقتی به سبد اضافه کردید تغییر کرده است.
              مبلغ کل با قیمت جدید حساب شده. قیمت جدید را تأیید کنید یا کتاب را از سبد حذف کنید.
              {priceChanged.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleAcknowledge()}
                  disabled={isPending("all")}
                  className="mt-2 block rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50"
                >
                  تأیید همهٔ قیمت‌های جدید
                </button>
              )}
            </Notice>
          )}
          {actionError && (
            <Notice tone="red" icon="⚠️">
              {actionError}
            </Notice>
          )}
        </div>

        {/* ═══ کتاب‌ها ═══ */}
        <ul className="mx-4 mt-4 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:mx-0">
          {items.map((item) => (
            <CartItem
              key={item.book.id}
              item={item}
              busy={isPending(item.book.id) || isPending("all")}
              onRemove={() => handleRemove(item.book.id)}
              onAcknowledge={() => handleAcknowledge(item.book.id)}
            />
          ))}
        </ul>
        </div>

        <div className="md:sticky md:top-18">

        {/* ═══ پرداخت از کیف پول ═══ */}
        {/* کیف پول تنها روش پرداخت است؛ برای همین انتخاب روش پرداخت (طرح Visily) حذف شد */}
        {payable.length > 0 && !allFree && (
          <section className="mx-4 mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:mx-0">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl" aria-hidden="true">
                👛
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900">پرداخت از کیف پول</p>
                <p className="text-sm text-gray-500">موجودی: {toFaNumber(balance)} تومان</p>
              </div>
            </div>

            {shortage > 0 ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                <p className="text-sm text-amber-800">
                  {toFaNumber(shortage)} تومان کم دارید.
                </p>
                <Link
                  to="/wallet"
                  className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
                >
                  شارژ کیف پول
                </Link>
              </div>
            ) : (
              <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">
                موجودی پس از خرید:{" "}
                <span className="font-semibold text-gray-900">{toFaNumber(balance - total)} تومان</span>
              </p>
            )}
          </section>
        )}

        {/* ═══ خلاصه ═══ */}
        {/* مالیات نداریم، پس فقط یک ردیف «مبلغ قابل پرداخت» لازم است */}
        {payable.length > 0 && (
          <section className="mx-4 mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:mx-0">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>تعداد کتاب‌ها</span>
              <span>{toFaNumber(payable.length)}</span>
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-3">
              <span className="font-bold text-gray-900">مبلغ قابل پرداخت</span>
              <span className="text-xl font-bold text-blue-600">{formatPrice(total)}</span>
            </div>
          </section>
        )}

        {/* ═══ نوار پرداخت ═══
            Mobile: fixed just above the app's bottom nav (BottomNavbar, h-14, on every page).
            md+: the last card of the sticky side column. */}
        <div className="fixed inset-x-0 bottom-14 z-20 border-t border-gray-200 bg-white/95 backdrop-blur md:static md:z-auto md:mx-0 md:mt-4 md:rounded-2xl md:border md:bg-white md:shadow-sm md:backdrop-blur-none">
          <div className="mx-auto max-w-md px-4 py-3 md:p-4">
            <button
              type="button"
              onClick={handlePay}
              disabled={!canPay}
              aria-busy={paying}
              className="flex h-14 w-full items-center justify-between rounded-2xl bg-blue-600 px-5 text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
            >
              <span className="flex items-center gap-2 font-semibold">
                {paying && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {paying ? "در حال پرداخت…" : allFree ? "دریافت رایگان" : "تأیید و پرداخت"}
              </span>
              {!allFree && <span className="text-lg font-bold">{formatPrice(total)}</span>}
            </button>
            <p className="mt-2 text-center text-xs text-gray-500">
              {unavailable.length > 0
                ? "اول کتاب‌هایی را که موجود نیستند از سبد حذف کنید."
                : priceChanged.length > 0
                ? "اول قیمت‌های جدید را تأیید کنید."
                : shortage > 0
                ? "برای پرداخت، کیف پول را شارژ کنید."
                : readyToPay
                ? "کتاب‌ها بلافاصله به کتابخانهٔ شما اضافه می‌شوند. خرید کتاب الکترونیکی بازپرداخت ندارد."
                : ""}
            </p>
          </div>
        </div>
        </div>
      </div>
    </PageShell>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

function PageShell({ count, onBack, children }) {
  return (
    <div dir="rtl" className="min-h-screen bg-gray-100">
      <div className="mx-auto w-full max-w-md md:max-w-5xl">
        <header className="sticky top-16 z-20 md:top-0 flex h-14 items-center justify-between border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <button
            type="button"
            onClick={onBack ?? (() => window.history.back())}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="flex items-center gap-2 text-base font-bold text-gray-900">
            سبد خرید
            {count > 0 && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                {toFaNumber(count)} کتاب
              </span>
            )}
          </h1>
          {/* 🔌 صفحهٔ اعلان‌ها هنوز ساخته نشده: <Link to="/notifications"> */}
          {/* md+: the side nav has the bell; invisible keeps the title centred */}
          <a
            href="/notifications"
            aria-label="اعلان‌ها"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-gray-200 md:invisible"
          >
            🔔
          </a>
        </header>
        {children}
      </div>
    </div>
  );
}

function CartItem({ item, busy, onRemove, onAcknowledge }) {
  const { book, status, price_seen: priceSeen } = item;
  const isUnavailable = status === "unavailable";
  const isChanged = status === "price_changed";
  const authors = book.authors.join("، ");

  return (
    <li className={`flex gap-3 p-4 ${isUnavailable ? "bg-gray-50" : isChanged ? "bg-amber-50/40" : ""}`}>
      <Link to={`/books/${book.id}`} className={`shrink-0 ${isUnavailable ? "opacity-40 grayscale" : ""}`}>
        {book.cover ? (
          <img
            src={book.cover}
            alt={`جلد ${book.title}`}
            className="h-24 w-16 rounded-md object-cover shadow-sm ring-1 ring-black/5"
          />
        ) : (
          // جایگزین جلد: حرف اول عنوان روی زمینهٔ آبی
          <div className="flex h-24 w-16 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-700 text-xl font-bold text-white shadow-sm">
            {book.title.charAt(0)}
          </div>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={`/books/${book.id}`}
              dir="auto"
              className={`block truncate font-semibold hover:text-blue-600 ${isUnavailable ? "text-gray-400" : "text-gray-900"}`}
            >
              {book.title}
            </Link>
            {authors && (
              <p dir="auto" className="mt-0.5 truncate text-sm text-gray-500">
                {authors}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`حذف ${book.title} از سبد`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-wait disabled:opacity-40"
          >
            🗑️
          </button>
        </div>

        <div className="mt-auto pt-2">
          {isUnavailable ? (
            <p className="text-xs font-medium text-gray-500">{UNAVAILABLE_MESSAGE}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2">
                {/* قیمت قبلی خط‌خورده، فقط اگر تغییر کرده باشد */}
                {isChanged && <span className="text-sm text-gray-400 line-through">{formatPrice(priceSeen)}</span>}
                <span className={`font-bold ${book.is_free ? "text-green-600" : "text-blue-600"}`}>
                  {formatPrice(book.price)}
                </span>
                {isChanged && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    {book.price > priceSeen ? "گران‌تر شده" : "ارزان‌تر شده"}
                  </span>
                )}
              </div>
              {/* The user confirms they saw the new price; or removes the book instead */}
              {isChanged && (
                <button
                  type="button"
                  onClick={onAcknowledge}
                  disabled={busy}
                  className="mt-2 rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                >
                  تأیید قیمت جدید
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function RemovedNotice({ removed }) {
  return (
    <Notice tone="blue" icon="📚">
      {removed.length === 1
        ? `«${removed[0].title}» را دارید و از سبد خرید برداشته شد.`
        : `${toFaNumber(removed.length)} کتاب را دارید و از سبد خرید برداشته شدند.`}
    </Notice>
  );
}

function Notice({ tone, icon, children }) {
  const styles = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border p-3 text-sm leading-6 ${styles}`}>
      <span aria-hidden="true">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <div className="mx-4 mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mb-3 text-4xl">⚠️</div>
      <h2 className="text-lg font-bold text-gray-900">سبد خرید بارگذاری نشد</h2>
      <p className="mt-2 text-sm text-gray-500">اتصال اینترنت را بررسی کنید.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 h-11 w-full rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700"
      >
        تلاش دوباره
      </button>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="mx-4 mt-4 animate-pulse space-y-4" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-3 p-4">
            <div className="h-24 w-16 rounded-md bg-gray-200" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-4 w-2/3 rounded bg-gray-200" />
              <div className="h-3 w-1/3 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-24 rounded-2xl bg-gray-200" />
    </div>
  );
}
