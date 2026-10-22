import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getConversation, markRead, sendMessage } from "../api/support";
import useGoBack from "../hooks/useGoBack";

// ═════════════════════════════════════════════════════════════
// این یک صفحه برای دو مسیر است (App.jsx):
//   /requests/:id  ← یک درخواست من (RequestEntry) و گفتگوی آن با پشتیبانی
//   /uploads/:id   ← یک کتاب بارگذاری‌شدهٔ من و گفتگوی آن با پشتیبانی
// بالای صفحه با هم فرق دارد (کارت جزئیات)، ولی گفتگو دقیقاً یکی است.
//
// 🔌 بکند: src/api/support.js. سرور فقط درخواست‌ها و کتاب‌های خود کاربر را برمی‌گرداند؛
// با عوض کردن عدد آدرس، گفتگوی کس دیگری پیدا نمی‌شود (404).
//
// فرستندهٔ پیام‌ها: "me" (کاربر) | "support" (همیشه با نام «پشتیبانی مگابوک») | "system"
// (سرور خودش هنگام تغییر وضعیت درخواست یا کتاب، یا بستن و بازگشایی گفتگو، می‌نویسد).
// متن پیام‌ها همیشه به‌صورت متن ساده نمایش داده می‌شود؛ React آن را escape می‌کند.
// ═════════════════════════════════════════════════════════════

const MAX_LENGTH = 2000;
const POLL_INTERVAL = 15000; // هر ۱۵ ثانیه
const HOUR = 60 * 60 * 1000;

// وضعیت گفتگو برای صفحه:
//   "open"       ← می‌شود پیام داد
//   "read_only"  ← درخواست تأمین شده؛ گفتگو خودکار بسته شده و فقط قابل خواندن است
//   "closed"     ← پشتیبانی گفتگو را بسته (قابل خواندن است، پیام تازه نه)
function stateOf(conversation) {
  if (conversation.state === "open") return "open";
  return conversation.closed_kind === "fulfilled" ? "read_only" : "closed";
}

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════
const toFaNumber = (n) => Number(n).toLocaleString("fa-IR");
const displayIsbn = (isbn) => `${isbn.slice(0, 3)}-${isbn.slice(3)}`;
const formatTime = (iso) => new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
const formatDay = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * HOUR);
  if (d.toDateString() === today.toDateString()) return "امروز";
  if (d.toDateString() === yesterday.toDateString()) return "دیروز";
  return d.toLocaleDateString("fa-IR", { month: "long", day: "numeric" });
};

const REQUEST_STATUS = {
  open: { label: "در انتظار تأمین", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  fulfilled: { label: "تأمین‌شده", className: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "ردشده", className: "bg-red-50 text-red-700 ring-red-200" },
};
const UPLOAD_STATUS = {
  pending: { label: "در انتظار تأیید", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { label: "در فروشگاه", className: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "ردشده", className: "bg-red-50 text-red-700 ring-red-200" },
};

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function ConversationPage({ kind = "request" }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // The request entry or upload shown in the top card (the response's `item`)
  const [item, setItem] = useState(null);
  const [messages, setMessages] = useState([]);
  const [convState, setConvState] = useState("open");
  // جای خط «پیام‌های جدید» فقط یک بار، هنگام باز شدن صفحه، تعیین می‌شود
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | notfound | error

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");

  const scrollRef = useRef(null);
  const lastIdRef = useRef(0); // آخرین id پیام سرور؛ ref چون تغییرش نباید رندر کند
  const tempCounter = useRef(0); // ids for messages still being sent

  // ── بارگذاری اولیه ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getConversation(kind, id);
        if (cancelled) return;
        setItem(data.item);
        setMessages(data.messages);
        setConvState(stateOf(data.conversation));
        lastIdRef.current = data.messages.at(-1)?.id ?? 0;

        // Unread = from the other side (support or system), after the user's last read moment
        const lastRead = data.conversation.user_last_read_at;
        // Compared as dates: the server may write "…:28Z" or "…:28.5Z", which don't sort as text
        const isUnread = (msg) => msg.sender !== "me" && (!lastRead || new Date(msg.created_at) > new Date(lastRead));
        const firstUnread = data.messages.find(isUnread);
        setFirstUnreadId(firstUnread?.id ?? null);
        setStatus("ready");

        // Opening the page counts as reading it
        if (firstUnread) markRead(kind, id).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        const code = err.response?.status;
        if (code === 401) navigate("/login", { replace: true, state: { from: location } });
        else setStatus(code === 404 ? "notfound" : "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kind, id, navigate, location]);

  // ── Polling: هر ۱۵ ثانیه پیام‌های تازه را می‌پرسیم ──
  // ادمین فعلاً از پنل جنگو جواب می‌دهد و سرور راهی برای «هل دادن» پیام به
  // مرورگر ندارد، پس مرورگر خودش هر چند ثانیه سر می‌زند. وقتی تب در پس‌زمینه
  // است درخواست نمی‌زنیم تا سرور بی‌دلیل شلوغ نشود.
  useEffect(() => {
    if (status !== "ready") return;

    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await getConversation(kind, id, lastIdRef.current);
        // State comes back every time: support may close or reopen it meanwhile
        setConvState(stateOf(data.conversation));
        setItem(data.item);
        if (data.messages.length === 0) return;
        lastIdRef.current = data.messages.at(-1).id;
        // فقط پیام‌هایی را اضافه کن که هنوز نداریم (پیام خودم ممکن است قبلاً اضافه شده باشد)
        setMessages((prev) => {
          const known = new Set(prev.map((x) => x.id));
          return [...prev, ...data.messages.filter((x) => !known.has(x.id))];
        });
        if (data.messages.some((m) => m.sender !== "me")) markRead(kind, id).catch(() => {});
      } catch {
        // خطای موقت شبکه؛ دور بعد دوباره امتحان می‌شود
      }
    }, POLL_INTERVAL);

    return () => clearInterval(timer);
  }, [status, kind, id]);

  // ── با هر پیام تازه، به پایین گفتگو اسکرول کن ──
  // useLayoutEffect قبل از نقاشی صفحه اجرا می‌شود، پس پرش دیده نمی‌شود.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, status]);

  async function handleSend(text) {
    const body = text.trim();
    if (!body || convState !== "open") return;

    // Optimistic UI: پیام فوراً با حالت «در حال ارسال» نمایش داده می‌شود و
    // بعد از جواب سرور با نسخهٔ واقعی (id و زمان سرور) جایگزین می‌شود.
    tempCounter.current += 1;
    const tempId = `temp-${tempCounter.current}`;
    setMessages((prev) => [
      ...prev.filter((m) => m.text !== body || m.status !== "failed"),
      { id: tempId, sender: "me", text: body, created_at: new Date().toISOString(), status: "sending" },
    ]);
    setDraft("");
    setSendError("");

    try {
      const saved = await sendMessage(kind, id, body);
      lastIdRef.current = Math.max(lastIdRef.current, saved.id);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? saved : m)));
    } catch (err) {
      const code = err.response?.status;
      if (code === 409 || code === 429 || code === 400) {
        // The message wasn't saved: take it back into the box so nothing typed is lost
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(body);
        if (code === 409) {
          // گفتگو همین الان بسته شد
          const data = await getConversation(kind, id, lastIdRef.current).catch(() => null);
          if (data) setConvState(stateOf(data.conversation));
          setSendError("این گفتگو دیگر باز نیست و پیام ارسال نشد.");
        } else if (code === 429) {
          setSendError("پیام‌ها خیلی پشت سر هم فرستاده شدند. کمی صبر کنید و دوباره بفرستید.");
        } else {
          setSendError(err.response?.data?.text?.[0] ?? "پیام ارسال نشد.");
        }
      } else {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)));
      }
    }
  }

  // ── حالت‌های بارگذاری و خطا ──
  if (status === "loading") return <Shell kind={kind}><LoadingState /></Shell>;
  if (status === "notfound" || status === "error") {
    return (
      <Shell kind={kind}>
        <div className="mx-4 mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">{status === "notfound" ? "🔍" : "⚠️"}</div>
          <h2 className="text-lg font-bold text-gray-900">
            {status === "notfound" ? "پیدا نشد" : "بارگذاری ناموفق بود"}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {status === "notfound"
              ? kind === "request" ? "این درخواست وجود ندارد یا متعلق به شما نیست." : "این کتاب وجود ندارد یا متعلق به شما نیست."
              : "اتصال اینترنت را بررسی کنید."}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell kind={kind}>
      {/* کارت جزئیات بالای صفحه؛ گفتگو بقیهٔ ارتفاع را پر می‌کند */}
      <div className="shrink-0 px-4 pt-3">
        {kind === "request" ? <RequestSummary item={item} /> : <UploadSummary item={item} />}
      </div>

      {/* ═══ گفتگو ═══ */}
      <section className="mx-4 my-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white" aria-hidden="true">
            م
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">پشتیبانی مگابوک</p>
            <p className="text-xs text-gray-500">پاسخ‌ها معمولاً در کمتر از یک روز کاری</p>
          </div>
        </div>

        {/* aria-live: صفحه‌خوان پیام‌های تازه را خودکار می‌خواند */}
        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4" aria-live="polite">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              هنوز پیامی نیست. اگر سؤالی دارید، اینجا بپرسید.
            </p>
          )}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || formatDay(prev.created_at) !== formatDay(m.created_at);
            return (
              <div key={m.id}>
                {newDay && <DayDivider label={formatDay(m.created_at)} />}
                {m.id === firstUnreadId && <UnreadDivider />}
                <Message message={m} onRetry={() => handleSend(m.text)} />
              </div>
            );
          })}
        </div>

        <Composer
          state={convState}
          draft={draft}
          setDraft={setDraft}
          onSend={() => handleSend(draft)}
          error={sendError}
        />
      </section>
    </Shell>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های کوچک داخلی (فقط در همین صفحه استفاده می‌شوند)
// ═════════════════════════════════════════════════════════════

// h-dvh: ارتفاع واقعی صفحهٔ نمایش موبایل. h-screen در موبایل نوار آدرس
// مرورگر را حساب نمی‌کند و پایین صفحه (همان جعبهٔ پیام) زیرش می‌رود.
function Shell({ kind, children }) {
  const goBack = useGoBack();
  return (
    <div dir="rtl" className="flex h-dvh flex-col bg-gray-100">
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-2">
          <button
            type="button"
            onClick={goBack}
            aria-label="برگشت"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          >
            →
          </button>
          <h1 className="text-base font-bold text-gray-900">{kind === "request" ? "جزئیات درخواست" : "جزئیات بارگذاری"}</h1>
          {/* Same width as the back button, so the title stays centered */}
          <span className="h-10 w-10" aria-hidden="true" />
        </header>
        {children}
      </div>
    </div>
  );
}

function BookHeader({ item, badge }) {
  return (
    <div className="flex gap-3">
      {item.cover ? (
        <img src={item.cover} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
      ) : (
        <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-100 to-blue-200 text-xl" aria-hidden="true">
          📘
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h2 dir="auto" className="line-clamp-2 font-bold leading-snug text-gray-900">{item.title}</h2>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${badge.className}`}>{badge.label}</span>
        </div>
        {item.authors && <p dir="auto" className="mt-0.5 truncate text-sm text-gray-500">{item.authors}</p>}
        <p className="mt-1 text-xs text-gray-400">
          شابک <span dir="ltr" className="font-mono">{displayIsbn(item.isbn)}</span>
        </p>
      </div>
    </div>
  );
}

function RequestSummary({ item }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <BookHeader item={item} badge={REQUEST_STATUS[item.status]} />

      {item.note && (
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-600">
          <span className="font-medium text-gray-700">یادداشت شما: </span>
          {item.note}
        </p>
      )}

      {item.status === "rejected" && item.rejection_reason && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm leading-6 text-red-700 ring-1 ring-red-200">
          <span className="font-semibold">دلیل رد: </span>
          {item.rejection_reason}
        </p>
      )}

      {item.status === "fulfilled" && item.book_id && (
        <Link
          to={`/books/${item.book_id}`}
          className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <span aria-hidden="true">🛒</span>
          مشاهده و خرید کتاب
        </Link>
      )}
    </div>
  );
}

function UploadSummary({ item }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <BookHeader item={item} badge={UPLOAD_STATUS[item.status]} />

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-100 text-sm">
        <div className="bg-gray-50 p-3">
          <dt className="text-xs text-gray-500">سهم شما از هر فروش</dt>
          <dd className="mt-0.5 font-semibold text-gray-900">
            {item.seller_share === 0 ? "بدون سهم" : `${toFaNumber(item.seller_share)} تومان`}
          </dd>
        </div>
        <div className="bg-gray-50 p-3">
          <dt className="text-xs text-gray-500">قیمت فروشگاه</dt>
          {/* price تا تأیید خالی است؛ قیمت را مگابوک تعیین می‌کند */}
          <dd className="mt-0.5 font-semibold text-gray-900">
            {item.price === null ? <span className="font-normal text-gray-400">پس از تأیید</span> : item.price === 0 ? "رایگان" : `${toFaNumber(item.price)} تومان`}
          </dd>
        </div>
        {item.status === "approved" && (
          <>
            {/* تعداد فروش از سفارش‌ها و درآمد از دفتر تراکنش‌های کیف پول؛ هیچ‌کدام ستونی در Book نیست */}
            <div className="bg-gray-50 p-3">
              <dt className="text-xs text-gray-500">تعداد فروش</dt>
              <dd className="mt-0.5 font-semibold text-gray-900">{toFaNumber(item.sales_count)}</dd>
            </div>
            <div className="bg-gray-50 p-3">
              <dt className="text-xs text-gray-500">درآمد شما</dt>
              <dd className="mt-0.5 font-semibold text-green-700">{toFaNumber(item.earnings)} تومان</dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}

function Message({ message: m, onRetry }) {
  // پیام سیستمی: وسط‌چین، بدون حباب
  if (m.sender === "system") {
    return (
      <div className="flex justify-center py-1">
        <p className="max-w-[85%] rounded-full bg-gray-100 px-3 py-1 text-center text-xs leading-5 text-gray-600">
          {m.text}
        </p>
      </div>
    );
  }

  const mine = m.sender === "me";
  // در راست‌چین، پیام‌های خودم سمت چپ (انتهای خط) و پیام پشتیبانی سمت راست است؛
  // همان چیزی که کاربر ایرانی در تلگرام و واتس‌اپ فارسی دیده است.
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        dir="auto"
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-6 ${
          mine
            ? `rounded-bl-md bg-blue-600 text-white ${m.status === "sending" ? "opacity-70" : ""}`
            : "rounded-br-md bg-gray-100 text-gray-900"
        } ${m.status === "failed" ? "bg-red-50 text-red-800 ring-1 ring-red-200" : ""}`}
      >
        {m.text}
      </div>
      <div className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-gray-400">
        {m.status === "sending" && <span>در حال ارسال…</span>}
        {m.status === "failed" && (
          <button type="button" onClick={onRetry} className="font-semibold text-red-600 hover:underline">
            ارسال نشد · تلاش دوباره
          </button>
        )}
        {!m.status && <span>{formatTime(m.created_at)}</span>}
      </div>
    </div>
  );
}

function DayDivider({ label }) {
  return (
    <div className="flex items-center justify-center py-2">
      <span className="rounded-full bg-white px-3 text-[11px] font-medium text-gray-400">{label}</span>
    </div>
  );
}

function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 py-2" role="separator">
      <span className="h-px flex-1 bg-blue-200" />
      <span className="text-[11px] font-semibold text-blue-600">پیام‌های جدید</span>
      <span className="h-px flex-1 bg-blue-200" />
    </div>
  );
}

function Composer({ state, draft, setDraft, onSend, error }) {
  const textareaRef = useRef(null);

  // ارتفاع textarea با متن زیاد می‌شود، تا حداکثر حدود ۵ خط
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  if (state === "read_only") {
    return (
      <p className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">
        این درخواست تأمین شده و گفتگو فقط قابل خواندن است.
      </p>
    );
  }
  if (state === "closed") {
    return (
      <p className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-3 text-center text-sm leading-6 text-gray-500">
        این گفتگو توسط پشتیبانی بسته شده است. پیام‌های قبلی را می‌توانید بخوانید، ولی پیام تازه فرستاده نمی‌شود.
      </p>
    );
  }

  const remaining = MAX_LENGTH - draft.length;

  return (
    <div className="shrink-0 border-t border-gray-100 p-3">
      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <label htmlFor="message" className="sr-only">پیام</label>
        <textarea
          id="message"
          ref={textareaRef}
          rows={1}
          dir="auto"
          maxLength={MAX_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl+Enter (یا Cmd+Enter در مک) پیام را می‌فرستد؛ Enter تنها خط جدید است،
            // چون در موبایل کاربر برای پیام چندخطی به Enter نیاز دارد
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="پیام خود را بنویسید…"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-gray-300 bg-white px-4 py-2.5 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="ارسال پیام"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
        >
          {/* فلش ارسال در راست‌چین رو به چپ است */}
          <span aria-hidden="true">←</span>
        </button>
      </form>
      {remaining < 200 && (
        <p className="mt-1 text-left text-[11px] text-gray-400">{toFaNumber(remaining)} کاراکتر باقی مانده</p>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 animate-pulse flex-col px-4 pt-3" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="h-32 rounded-2xl bg-gray-200" />
      <div className="my-3 flex-1 rounded-2xl bg-gray-200" />
    </div>
  );
}
