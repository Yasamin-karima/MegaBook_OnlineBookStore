import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBookFileLink } from "../api/catalog";

// ═════════════════════════════════════════════════════════════
// صفحهٔ خواندن کتاب (/library/:id/read)، برای کسی که کتاب را دارد (خریده یا بارگذاری کرده).
//
// فایل کامل کتاب خصوصی است (DECISIONS 3.15). یک لینک ساده کار نمی‌کند، چون مرورگر
// هدر JWT را نمی‌فرستد. برای همین:
//   ۱. با axios (که JWT را می‌فرستد) یک لینک امضاشدهٔ کوتاه‌مدت می‌گیریم
//      (GET /catalog/books/<id>/file-link/). اگر کتاب مال کاربر نباشد، 404 می‌آید.
//   ۲. همان لینک را در یک iframe باز می‌کنیم تا نمایشگر PDF خود مرورگر نشانش دهد.
//      فایل به‌صورت جریان می‌آید و برخلاف blob کل آن در حافظهٔ صفحه نمی‌ماند.
// مرورگرهای موبایل (مثل کروم اندروید) PDF را داخل صفحه نشان نمی‌دهند؛ برای همین
// دکمهٔ «دانلود / باز کردن در تب جدید» هم هست.
// ═════════════════════════════════════════════════════════════

export default function BookReaderPage({ onBack }) {
  const { id } = useParams();
  // { key, status: "ready" | "notowned" | "error", link }. If key isn't the current id,
  // the answer belongs to a previous book: we're still loading.
  const [result, setResult] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [opening, setOpening] = useState(false);
  const key = `${id}:${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    getBookFileLink(id)
      .then((link) => !cancelled && setResult({ key, status: "ready", link }))
      .catch((err) => {
        if (cancelled) return;
        setResult({ key, status: err.response?.status === 404 ? "notowned" : "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, key]);

  const current = result?.key === key ? result : null;

  // The link in the iframe expires after a few minutes, so a new tab gets a FRESH link.
  // The tab is opened right on the click (before the request) and filled in afterwards;
  // a window opened after an `await` would be blocked as a pop-up.
  async function openInNewTab() {
    const tab = window.open("", "_blank");
    setOpening(true);
    try {
      const link = await getBookFileLink(id);
      if (tab) tab.location.href = link.url;
      else window.location.href = link.url;
    } catch {
      tab?.close();
    } finally {
      setOpening(false);
    }
  }

  return (
    <div dir="rtl" className="flex h-screen flex-col bg-gray-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="بازگشت"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-100"
        >
          →
        </button>
        <h1 dir="auto" className="min-w-0 flex-1 truncate font-bold text-gray-900">
          {current?.status === "ready" ? current.link.title : "خواندن کتاب"}
        </h1>
        {current?.status === "ready" && (
          <button
            type="button"
            onClick={openInNewTab}
            disabled={opening}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70"
          >
            <span aria-hidden="true">⬇️</span>
            دانلود / تب جدید
          </button>
        )}
      </header>

      {!current && (
        <div className="flex flex-1 items-center justify-center" aria-busy="true">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>
      )}

      {current?.status === "ready" && (
        <>
          <iframe title={current.link.title} src={current.link.url} className="w-full flex-1 border-0 bg-white" />
          <p className="shrink-0 bg-white px-4 py-2 text-center text-xs leading-5 text-gray-500 md:hidden">
            اگر کتاب اینجا نمایش داده نشد، دکمهٔ «دانلود / تب جدید» را بزنید.
          </p>
        </>
      )}

      {current?.status === "notowned" && (
        <Message icon="🔒" text="شما این کتاب را ندارید. برای خواندن، اول آن را بخرید.">
          <Link
            to={`/books/${id}`}
            className="mt-5 flex h-11 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700"
          >
            مشاهدهٔ کتاب
          </Link>
        </Message>
      )}

      {current?.status === "error" && (
        <Message icon="⚠️" text="فایل کتاب دریافت نشد. دوباره تلاش کنید.">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-5 flex h-11 items-center justify-center rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700"
          >
            تلاش دوباره
          </button>
        </Message>
      )}
    </div>
  );
}

function Message({ icon, text, children }) {
  return (
    <div className="mx-auto mt-10 flex w-full max-w-md flex-col items-center px-4">
      <div className="flex w-full flex-col items-center rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
        <span className="text-4xl" aria-hidden="true">{icon}</span>
        <p className="mt-3 text-sm leading-7 text-gray-600">{text}</p>
        {children}
      </div>
    </div>
  );
}
