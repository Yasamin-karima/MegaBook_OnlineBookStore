import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, formatDateTime } from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// پنل گفتگوی ادمین با یک کاربر. در سه بخش استفاده می‌شود: بررسی کتاب‌ها،
// درخواست‌ها و صندوق گفتگوها.
//
// خود پنل نمی‌داند گفتگو مال یک بارگذاری است یا یک RequestEntry؛ صفحه‌ای که
// از آن استفاده می‌کند یک شیء api می‌دهد با این چهار تابع (conversationApi در api/admin.js):
//   api.load(afterId)            → { conversation, messages, history }
//   api.send(text)               → پیام ذخیره‌شده
//   api.markRead()
//   api.setState("close"|"reopen", reason) → { conversation }
// conversation: { state: "open"|"closed", closed_kind: null|"fulfilled"|"support",
//                 closed_at, closed_by, close_reason }
// با این کار منطق گفتگو (polling، اسکرول، بستن و بازگشایی) یک جا نوشته
// می‌شود و فقط آدرس‌ها از بیرون می‌آیند.
//
// نکته: والد باید key={شناسهٔ گفتگو} بدهد، تا با عوض شدن گفتگو، پنل کامل از
// نو ساخته شود و پیش‌نویس و تایمر گفتگوی قبلی با گفتگوی جدید قاطی نشود.
//
// پیام‌ها از دید ادمین: sender = "user" | "support" | "system"
// author: نام ادمینی که پیام support را فرستاده (فقط ادمین‌ها می‌بینند)
//
// بستن فقط جلوی پیام کاربر را می‌گیرد؛ پشتیبانی در گفتگوی بسته (دستی یا به‌خاطر
// تأمین درخواست) هم می‌نویسد (تصمیم ۱۲.۴). دلیل بستن داخلی است و کاربر فقط
// پیام خنثی «این گفت‌وگو توسط پشتیبانی بسته شد» را می‌بیند.
//
// اعلان: پاسخ ادمین برای کاربر اعلان می‌سازد، یکی برای هر گفتگو نه هر پیام؛ این
// کار در سرور (support.services.post_support_message) انجام می‌شود.
// ═════════════════════════════════════════════════════════════

const POLL_INTERVAL = 15000;

export default function AdminConversationPanel({ api, title, subtitle, onToast, onChanged }) {
  const [messages, setMessages] = useState([]);
  const [conv, setConv] = useState({ state: "open" });
  const [history, setHistory] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const lastIdRef = useRef(0);
  // api در هر رندر والد یک شیء تازه است؛ در ref نگهش می‌داریم تا effectها
  // به خاطر آن دوباره اجرا نشوند
  const apiRef = useRef(api);
  apiRef.current = api;

  function append(newMessages) {
    if (!newMessages.length) return;
    lastIdRef.current = Math.max(lastIdRef.current, ...newMessages.map((m) => m.id));
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      return [...prev, ...newMessages.filter((m) => !known.has(m.id))];
    });
  }

  useEffect(() => {
    let cancelled = false;
    apiRef.current
      .load(0)
      .then((r) => {
        if (cancelled) return;
        append(r.messages);
        setConv(r.conversation);
        setHistory(r.history ?? []);
        setLoadState("ready");
      })
      .catch(() => !cancelled && setLoadState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loadState !== "ready") return;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await apiRef.current.load(lastIdRef.current);
        setConv(r.conversation);
        if (r.messages.length) {
          append(r.messages);
          // The first load marks it read on the server; polling doesn't, so say so here
          apiRef.current.markRead().catch(() => {});
        }
      } catch {
        /* دور بعد */
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [loadState]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  async function refresh() {
    const r = await apiRef.current.load(lastIdRef.current);
    setConv(r.conversation);
    append(r.messages);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const msg = await apiRef.current.send(text);
      append([msg]);
      setDraft("");
    } catch (err) {
      onToast?.(errorMessage(err, "پیام ارسال نشد."), "red");
    } finally {
      setSending(false);
    }
  }

  async function changeState(action) {
    setBusy(true);
    try {
      const r = await apiRef.current.setState(action, closeReason.trim());
      setConv(r.conversation);
      setClosing(false);
      setCloseReason("");
      await refresh();
      onChanged?.();
    } catch (err) {
      onToast?.(errorMessage(err), "red");
      refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const closed = conv.state === "closed";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-gray-900">{title}</p>
          <p className="truncate text-xs text-gray-500">{subtitle ?? "پیام‌های شما با نام «پشتیبانی مگابوک» دیده می‌شوند."}</p>
        </div>
        {/* «بستن» فقط برای گفتگویی که پیامی دارد (گفتگو با اولین پیام ساخته می‌شود).
            گفتگوی بسته‌شده به‌خاطر تأمین درخواست را هم می‌شود دستی بست تا خودکار باز نشود. */}
        {loadState === "ready" && conv.closed_kind !== "support" && messages.length > 0 && (
          <button type="button" onClick={() => setClosing((v) => !v)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
            بستن گفتگو
          </button>
        )}
        {closed && (
          <button type="button" onClick={() => changeState("reopen")} disabled={busy} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50">
            بازگشایی
          </button>
        )}
      </div>

      {closing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (closeReason.trim()) changeState("close");
          }}
          className="shrink-0 space-y-2 border-b border-red-100 bg-red-50 p-3"
        >
          <label htmlFor="close-reason" className="block text-xs font-medium text-red-800">
            دلیل بستن — داخلی است و همراه نام شما ثبت می‌شود؛ کاربر فقط پیام «بسته شد» را می‌بیند
          </label>
          <input
            id="close-reason"
            autoFocus
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            className="h-9 w-full rounded-lg border border-red-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/40"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setClosing(false)} className="h-8 rounded-lg px-3 text-xs font-semibold text-gray-600 hover:bg-white">
              انصراف
            </button>
            <button type="submit" disabled={!closeReason.trim() || busy} className="h-8 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-40">
              بستن گفتگو
            </button>
          </div>
        </form>
      )}

      {closed && (
        <p className="shrink-0 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs leading-5 text-gray-600">
          {conv.closed_kind === "fulfilled"
            ? "درخواست تأمین شده و کاربر دیگر نمی‌تواند پیام بفرستد."
            : `بسته‌شده توسط ${conv.closed_by ?? "پشتیبانی"} · ${formatDateTime(conv.closed_at)}${conv.close_reason ? ` · دلیل (داخلی): ${conv.close_reason}` : ""}`}
        </p>
      )}
      {history.length > 0 && (
        <details className="shrink-0 border-b border-gray-100 px-4 py-1.5 text-xs text-gray-500">
          <summary className="cursor-pointer">سابقهٔ بستن و بازگشایی ({history.length.toLocaleString("fa-IR")})</summary>
          <ul className="mt-1 space-y-0.5 pb-1">
            {history.map((h, i) => (
              <li key={i}>
                {h.action === "close" ? "بستن" : "بازگشایی"} · {h.admin} · {formatDateTime(h.created_at)}
                {h.reason && ` · ${h.reason}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4" aria-live="polite">
        {loadState === "loading" && <p className="py-8 text-center text-sm text-gray-400">در حال بارگذاری…</p>}
        {loadState === "error" && <p className="py-8 text-center text-sm text-red-600">گفتگو بارگذاری نشد.</p>}
        {loadState === "ready" && messages.length === 0 && <p className="py-8 text-center text-sm text-gray-400">هنوز پیامی نیست.</p>}
        {messages.map((m) =>
          m.sender === "system" ? (
            <div key={m.id} className="flex justify-center">
              <p className="max-w-[90%] rounded-full bg-gray-100 px-3 py-1 text-center text-xs leading-5 text-gray-600">{m.text}</p>
            </div>
          ) : (
            // از دید ادمین، پیام‌های پشتیبانی پیام‌های «خودمان»اند: آبی و سمت چپ
            <div key={m.id} className={`flex flex-col ${m.sender === "support" ? "items-end" : "items-start"}`}>
              <div
                dir="auto"
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6 ${
                  m.sender === "support" ? "rounded-bl-md bg-blue-600 text-white" : "rounded-br-md bg-gray-100 text-gray-900"
                }`}
              >
                {m.text}
              </div>
              <span className="mt-0.5 px-1 text-[11px] text-gray-400">
                {m.sender === "support" && m.author ? `${m.author} · ` : ""}
                {formatDateTime(m.created_at)}
              </span>
            </div>
          )
        )}
      </div>

      <form onSubmit={handleSend} className="shrink-0 border-t border-gray-100 p-3">
        {closed && <p className="mb-2 text-[11px] text-gray-500">گفتگو برای کاربر بسته است؛ پیام شما همچنان به او می‌رسد.</p>}
        <div className="flex items-end gap-2">
          <label htmlFor="admin-message" className="sr-only">پیام</label>
          <textarea
            id="admin-message"
            rows={2}
            dir="auto"
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(e);
            }}
            placeholder="پاسخ… (Ctrl+Enter برای ارسال)"
            className="max-h-32 flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm leading-6 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="h-10 shrink-0 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
          >
            ارسال
          </button>
        </div>
      </form>
    </div>
  );
}
