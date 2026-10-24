import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDateTime } from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// پنل گفتگوی ادمین با یک کاربر. در سه بخش استفاده می‌شود: بررسی کتاب‌ها،
// درخواست‌ها و صندوق گفتگوها.
//
// خود پنل نمی‌داند گفتگو مال یک بارگذاری است یا یک RequestEntry؛ صفحه‌ای که
// از آن استفاده می‌کند یک شیء api می‌دهد با این چهار تابع:
//   api.load(afterId)            → { messages, conversation_state }
//   api.send(text)               → پیام ذخیره‌شده
//   api.markRead(lastMessageId)
//   api.setState("close"|"reopen", reason)
// با این کار منطق گفتگو (polling، اسکرول، بستن و بازگشایی) یک جا نوشته
// می‌شود و فقط آدرس‌ها از بیرون می‌آیند.
//
// نکته: والد باید key={شناسهٔ گفتگو} بدهد، تا با عوض شدن گفتگو، پنل کامل از
// نو ساخته شود و پیش‌نویس و تایمر گفتگوی قبلی با گفتگوی جدید قاطی نشود.
//
// پیام‌ها از دید ادمین: sender = "user" | "support" | "system"
// author: نام ادمینی که پیام support را فرستاده (فقط ادمین‌ها می‌بینند)
//
// TODO(اعلان): پاسخ ادمین → اعلان برای کاربر؛ یک اعلان برای هر گفتگو، نه هر
// پیام. این کار سمت سرور در endpoint ارسال پیام انجام می‌شود، نه اینجا.
// ═════════════════════════════════════════════════════════════

const POLL_INTERVAL = 15000;

export default function AdminConversationPanel({ api, title, subtitle, onToast, readOnlyNote }) {
  const [messages, setMessages] = useState([]);
  const [convState, setConvState] = useState("open");
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
        setConvState(r.conversation_state);
        setLoadState("ready");
        if (lastIdRef.current) apiRef.current.markRead(lastIdRef.current);
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
        setConvState(r.conversation_state);
        if (r.messages.length) {
          append(r.messages);
          apiRef.current.markRead(lastIdRef.current);
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
    setConvState(r.conversation_state);
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
      onToast?.(err.response?.status === 409 ? "این گفتگو بسته است." : "پیام ارسال نشد.", "red");
      if (err.response?.status === 409) refresh().catch(() => {});
    } finally {
      setSending(false);
    }
  }

  async function changeState(action) {
    setBusy(true);
    try {
      await apiRef.current.setState(action, closeReason.trim());
      setClosing(false);
      setCloseReason("");
      await refresh();
    } catch {
      onToast?.("انجام نشد. دوباره تلاش کنید.", "red");
    } finally {
      setBusy(false);
    }
  }

  const canWrite = convState === "open";

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-gray-900">{title}</p>
          <p className="truncate text-xs text-gray-500">{subtitle ?? "پیام‌های شما با نام «پشتیبانی مگابوک» دیده می‌شوند."}</p>
        </div>
        {convState === "open" && (
          <button type="button" onClick={() => setClosing((v) => !v)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
            بستن گفتگو
          </button>
        )}
        {convState === "closed" && (
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
            دلیل بستن — برای کاربر فرستاده و همراه نام شما ثبت می‌شود
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

      {canWrite ? (
        <form onSubmit={handleSend} className="flex shrink-0 items-end gap-2 border-t border-gray-100 p-3">
          <label htmlFor="admin-message" className="sr-only">پیام</label>
          <textarea
            id="admin-message"
            rows={2}
            dir="auto"
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
        </form>
      ) : (
        <p className="shrink-0 border-t border-gray-100 bg-gray-50 p-3 text-center text-xs text-gray-500">
          {convState === "read_only"
            ? readOnlyNote ?? "این گفتگو فقط قابل خواندن است."
            : "این گفتگو بسته است و کاربر نمی‌تواند پیام بفرستد."}
        </p>
      )}
    </div>
  );
}
