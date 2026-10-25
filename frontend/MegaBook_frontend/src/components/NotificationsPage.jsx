import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications";
import useGoBack from "../hooks/useGoBack";
import useNotifications from "../hooks/useNotifications";
import { formatRelativeTime, toFaNumber } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// صفحه‌ی اعلان‌ها: /notifications (فقط کاربر واردشده؛ ProtectedRoute در App.jsx)
// داده از GET /notifications/ می‌آید (src/api/notifications.js): جدیدترین اول، فقط ۹۰ روز اخیر.
//   • باز کردن این صفحه چیزی را خوانده‌شده نمی‌کند.
//   • کلیک روی اعلان آن را خوانده‌شده می‌کند و به مقصدش می‌رود (لینک ادمین در تب تازه).
//   • متن و آیکون را بک‌اند می‌سازد (notifications/texts.py)؛ این‌جا فقط نمایش داده می‌شوند.
// بعد از هر «خواندن»، شمارنده‌ی زنگوله (NotificationsProvider) دوباره پرسیده می‌شود.
// ═════════════════════════════════════════════════════════════

export default function NotificationsPage() {
  const goBack = useGoBack();
  const navigate = useNavigate();
  const { refresh: refreshUnread } = useNotifications();

  const [attempt, setAttempt] = useState(0);
  // { key, status: ready | error, items, next, page }
  const [result, setResult] = useState({ key: null, status: "loading", items: [], next: null, page: 1 });
  const status = result.key === attempt ? result.status : "loading";
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = attempt;
    getNotifications(1)
      .then((data) => !cancelled && setResult({ key, status: "ready", items: data.results, next: data.next, page: 1 }))
      .catch(() => !cancelled && setResult({ key, status: "error", items: [], next: null, page: 1 }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function handleLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getNotifications(result.page + 1);
      setResult((prev) => ({ ...prev, items: [...prev.items, ...data.results], next: data.next, page: prev.page + 1 }));
    } catch {
      /* the button stays; the user can try again */
    } finally {
      setLoadingMore(false);
    }
  }

  function markLocally(predicate) {
    const now = new Date().toISOString();
    setResult((prev) => ({
      ...prev,
      items: prev.items.map((n) => (predicate(n) && !n.read_at ? { ...n, read_at: now } : n)),
    }));
  }

  async function handleOpen(notification) {
    if (!notification.read_at) {
      markLocally((n) => n.id === notification.id);
      // Navigating doesn't wait for a slow network; a failed mark only leaves it unread
      markNotificationRead(notification.id).catch(() => {}).finally(refreshUnread);
    }
    const link = notification.link;
    // Staff notifications link into the admin dashboard (/admin/...), a page of this app too
    if (link?.kind === "app") navigate(link.path);
  }

  async function handleMarkAll() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      markLocally(() => true);
      refreshUnread();
    } catch {
      /* nothing changed; the button can be pressed again */
    } finally {
      setMarkingAll(false);
    }
  }

  const hasUnread = result.items.some((n) => !n.read_at);

  return (
    <div dir="rtl" className="min-h-screen bg-gray-100 pb-12">
      <div className="mx-auto w-full max-w-md md:max-w-2xl">
        {/* ═══ نوار بالا ═══ */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-gray-100/90 px-2 backdrop-blur">
          <button
            type="button"
            onClick={goBack}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="text-base font-bold text-gray-900">اعلان‌ها</h1>
          {/* Keeps the title centred */}
          <span className="h-10 w-10" aria-hidden="true" />
        </header>

        {status === "loading" && <ListSkeleton />}

        {status === "error" && (
          <div className="mx-4 mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-3 text-4xl">⚠️</div>
            <p className="text-sm text-gray-500">دریافت اعلان‌ها ناموفق بود. اتصال اینترنت را بررسی کنید.</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700"
            >
              تلاش دوباره
            </button>
          </div>
        )}

        {status === "ready" && result.items.length === 0 && (
          <div className="mx-4 mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-3 text-4xl" aria-hidden="true">🔔</div>
            <h2 className="text-lg font-bold text-gray-900">اعلانی ندارید</h2>
            <p className="mt-2 text-sm text-gray-500">خبرهای خریدها، درخواست‌ها، کیف پول و پشتیبانی این‌جا نمایش داده می‌شوند.</p>
          </div>
        )}

        {status === "ready" && result.items.length > 0 && (
          <>
            <div className="flex h-12 items-center justify-between px-4">
              <p className="text-xs text-gray-500">اعلان‌های ۹۰ روز اخیر</p>
              {hasUnread && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  disabled={markingAll}
                  className="rounded-lg px-2 py-1 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-60"
                >
                  {markingAll ? "در حال انجام…" : "همه را خوانده‌شده کن"}
                </button>
              )}
            </div>

            <ul className="mx-4 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {result.items.map((n) => (
                <li key={n.id}>
                  <NotificationRow notification={n} onOpen={handleOpen} />
                </li>
              ))}
            </ul>

            {result.next && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="mx-4 mt-4 flex h-11 w-[calc(100%-2rem)] items-center justify-center rounded-xl border border-blue-200 bg-white text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? "در حال بارگذاری…" : "بیشتر"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// One row. Unread: a light blue background, bold text and a blue dot.
// A notification whose source was deleted (link null) is shown but not clickable.
function NotificationRow({ notification, onOpen }) {
  const unread = !notification.read_at;
  const clickable = Boolean(notification.link) || unread;
  const content = (
    <>
      <span className="mt-0.5 shrink-0 text-xl" aria-hidden="true">{notification.icon}</span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className={`block text-sm leading-6 ${unread ? "font-semibold text-gray-900" : "text-gray-600"}`}>
          {notification.text}
        </span>
        <span className="mt-1 block text-xs text-gray-400">
          {formatRelativeTime(notification.created_at)}
          {notification.link?.path?.startsWith("/admin") && " · داشبورد مدیریت"}
        </span>
      </span>
      {unread && (
        <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600">
          <span className="sr-only">خوانده‌نشده</span>
        </span>
      )}
    </>
  );
  const className = `flex w-full items-start gap-3 px-4 py-3 text-start ${unread ? "bg-blue-50/60" : "bg-white"}`;
  if (!clickable) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={`${className} hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600/40`}
    >
      {content}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="mx-4 mt-12 animate-pulse space-y-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200" aria-busy="true" aria-label="در حال بارگذاری">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 bg-white p-4">
          <div className="h-6 w-6 rounded-full bg-gray-200" />
          <div className="flex-1">
            <div className="h-3 w-full rounded bg-gray-200" />
            <div className="mt-2 h-3 w-1/3 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Used by the bells (Navbar, DesktopNav): the unread count as a small red badge
export function UnreadBadge({ count, className = "" }) {
  if (!count) return null;
  return (
    <span className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ${className}`}>
      {count > 99 ? "۹۹+" : toFaNumber(count)}
      <span className="sr-only"> اعلان خوانده‌نشده</span>
    </span>
  );
}
