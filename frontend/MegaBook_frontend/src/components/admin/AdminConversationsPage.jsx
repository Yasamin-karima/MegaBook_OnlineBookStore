import { useEffect, useState } from "react";
import AdminShell from "./AdminShell";
import AdminConversationPanel from "./AdminConversationPanel";
import {
  Badge, CountPill, EmptyDetail, FilterChips, QueueLayout, QueueSkeleton, SearchBox, Toast,
  clone, displayIsbn, httpError, notifyCountsChanged, timeAgo, toFaNumber, toLatinDigits,
  useDebounced, useToast, useUrlParam, wait,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «گفتگوها»
//
// یک صندوق برای همهٔ گفتگوها: گفتگوی هر درخواست‌کننده (RequestEntry) و
// گفتگوی هر بارگذاری. همین گفتگوها در بخش درخواست‌ها و بررسی کتاب‌ها هم
// دیده می‌شوند؛ اینجا فقط از زاویهٔ «چه کسی منتظر جواب ماست» مرتب شده‌اند.
//
// «منتظر پاسخ ما» = گفتگوی باز که آخرین پیامش از کاربر است.
// ترتیب این فیلتر از قدیمی به جدید است: کسی که بیشتر منتظر مانده اول.
//
// هر گفتگو یک شناسهٔ ترکیبی دارد: "entry:701" یا "upload:50"، چون دو نوع
// گفتگو در دو جدول جدا هستند و شناسهٔ عددی‌شان ممکن است تکراری باشد.
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// داده ماک (Mock)
// ═════════════════════════════════════════════════════════════
const HOUR = 60 * 60 * 1000;
const t = (h) => new Date(Date.now() - h * HOUR).toISOString();

let MOCK_CONVERSATIONS = [
  {
    key: "entry:703", kind: "entry", id: 703, user: { full_name: "سارا موسوی" }, state: "open",
    context: { title: "Beyond Good and Evil", isbn: "9780140449235", status_label: "در انتظار تأمین", request_id: 21 },
    last_message: { sender: "user", text: "تا آخر ترم لازمش دارم؛ احتمالش هست؟", created_at: t(11) }, unread_count: 1,
  },
  {
    key: "upload:50", kind: "upload", id: 50, user: { full_name: "یاسمین کریمی" }, state: "open",
    context: { title: "مبانی شبکه‌های پیچیده", isbn: "9786000000005", status_label: "در انتظار بررسی", book_id: 50 },
    last_message: { sender: "user", text: "سلام. اگر سهم ۸۰ هزار تومان زیاد است، می‌توانم کمترش کنم.", created_at: t(1) }, unread_count: 1,
  },
  {
    key: "entry:701", kind: "entry", id: 701, user: { full_name: "یاسمین کریمی" }, state: "open",
    context: { title: "Beyond Good and Evil", isbn: "9780140449235", status_label: "در انتظار تأمین", request_id: 21 },
    last_message: { sender: "user", text: "سلام. ترجمهٔ فارسی این کتاب را هم دارید؟", created_at: t(49) }, unread_count: 1,
  },
  {
    key: "upload:53", kind: "upload", id: 53, user: { full_name: "مریم احمدی" }, state: "open",
    context: { title: "سمفونی مردگان", isbn: "9789643113445", status_label: "در انتظار بررسی", book_id: 53 },
    last_message: { sender: "user", text: "سهمی نمی‌خواهم؛ فقط می‌خواهم کتاب در دسترس باشد.", created_at: t(4.9) }, unread_count: 2,
  },
  {
    key: "upload:42", kind: "upload", id: 42, user: { full_name: "یاسمین کریمی" }, state: "open",
    context: { title: "یادداشت‌های من", isbn: "9786000000012", status_label: "در فروشگاه", book_id: 42 },
    last_message: { sender: "system", text: "کتاب تأیید شد و در فروشگاه قرار گرفت.", created_at: t(478) }, unread_count: 0,
  },
  {
    key: "upload:51", kind: "upload", id: 51, user: { full_name: "یاسمین کریمی" }, state: "closed",
    context: { title: "جزوهٔ جبر خطی", isbn: "9786000000029", status_label: "ردشده", book_id: 51 },
    last_message: { sender: "system", text: "گفتگو توسط پشتیبانی بسته شد: پیام‌های تکراری.", created_at: t(380) }, unread_count: 0,
  },
];

const MOCK_MESSAGES = {
  "entry:703": [
    { id: 1, sender: "system", text: "درخواست ثبت شد.", created_at: t(12) },
    { id: 2, sender: "user", text: "تا آخر ترم لازمش دارم؛ احتمالش هست؟", created_at: t(11) },
  ],
  "upload:50": [
    { id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(30) },
    { id: 2, sender: "user", text: "سلام. اگر سهم ۸۰ هزار تومان زیاد است، می‌توانم کمترش کنم.", created_at: t(1) },
  ],
  "entry:701": [
    { id: 1, sender: "system", text: "درخواست ثبت شد.", created_at: t(50) },
    { id: 2, sender: "user", text: "سلام. ترجمهٔ فارسی این کتاب را هم دارید؟", created_at: t(49) },
  ],
  "upload:53": [
    { id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(6) },
    { id: 2, sender: "user", text: "این نسخه چاپ دوازدهم است.", created_at: t(5) },
    { id: 3, sender: "user", text: "سهمی نمی‌خواهم؛ فقط می‌خواهم کتاب در دسترس باشد.", created_at: t(4.9) },
  ],
  "upload:42": [
    { id: 1, sender: "support", text: "با سهم ۶۰ هزار تومان موافقیم و قیمت فروشگاه ۷۵ هزار تومان شد.", created_at: t(480), author: "سارا" },
    { id: 2, sender: "system", text: "کتاب تأیید شد و در فروشگاه قرار گرفت.", created_at: t(478) },
  ],
  "upload:51": [
    { id: 1, sender: "system", text: "کتاب رد شد: فایل PDF ناقص است.", created_at: t(390) },
    { id: 2, sender: "system", text: "گفتگو توسط پشتیبانی بسته شد: پیام‌های تکراری.", created_at: t(380) },
  ],
};

const FILTERS = [
  { key: "waiting", label: "منتظر پاسخ ما" },
  { key: "open", label: "همهٔ گفتگوهای باز" },
  { key: "closed", label: "بسته‌شده" },
  { key: "all", label: "همه" },
];

const KINDS = [
  { key: "all", label: "همه" },
  { key: "entry", label: "درخواست‌ها" },
  { key: "upload", label: "بارگذاری‌ها" },
];

// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند (فقط is_staff). آدرس‌ها پیشنهادی‌اند.
// ═════════════════════════════════════════════════════════════

const isWaiting = (c) => c.state === "open" && c.last_message?.sender === "user";

// GET /api/admin/conversations/?filter=waiting|open|closed|all&kind=entry|upload&search=&page=
// این endpoint دو نوع گفتگو را در یک لیست ترکیب می‌کند. اگر گفتگوهای هر دو
// نوع در یک مدل Conversation باشند (با FK به RequestEntry یا Book)، این یک
// کوئری ساده است؛ اگر دو مدل جدا باشند، باید دو کوئری را با union ترکیب کرد.
// last_message و unread_count با annotate + Subquery (جلوگیری از N+1).
async function fetchInbox({ filter, kind, search }) {
  await wait(450);
  const q = search.trim().toLowerCase();
  const rows = MOCK_CONVERSATIONS.filter((c) =>
    filter === "waiting" ? isWaiting(c) : filter === "open" ? c.state === "open" : filter === "closed" ? c.state === "closed" : true
  )
    .filter((c) => kind === "all" || c.kind === kind)
    .filter((c) => !q || c.user.full_name.includes(q) || c.context.title.toLowerCase().includes(q) || c.context.isbn.includes(q))
    .sort((a, b) =>
      filter === "waiting"
        ? a.last_message.created_at.localeCompare(b.last_message.created_at)
        : b.last_message.created_at.localeCompare(a.last_message.created_at)
    );
  return { count: rows.length, results: clone(rows), waiting: MOCK_CONVERSATIONS.filter(isWaiting).length };
}

// گفتگوی یک مورد؛ آدرس بسته به نوع:
//   entry  → /api/admin/request-entries/<id>/...
//   upload → /api/admin/books/<id>/...
function conversationApi(conv, onChanged) {
  const list = () => MOCK_MESSAGES[conv.key];
  const sync = () => {
    const c = MOCK_CONVERSATIONS.find((x) => x.key === conv.key);
    c.last_message = clone(list().at(-1));
    onChanged();
  };
  return {
    load: async (after) => {
      await wait(250);
      const c = MOCK_CONVERSATIONS.find((x) => x.key === conv.key);
      return { messages: clone(list().filter((m) => m.id > after)), conversation_state: c.state };
    },
    send: async (text) => {
      await wait(450);
      const c = MOCK_CONVERSATIONS.find((x) => x.key === conv.key);
      if (c.state !== "open") throw httpError(409);
      const msg = { id: list().at(-1).id + 1, sender: "support", text, created_at: new Date().toISOString(), author: "شما" };
      list().push(msg);
      sync(); // آخرین پیام حالا از ماست → از «منتظر پاسخ ما» بیرون می‌رود
      return clone(msg);
    },
    markRead: async () => {
      MOCK_CONVERSATIONS.find((x) => x.key === conv.key).unread_count = 0;
    },
    setState: async (action, reason) => {
      await wait(400);
      MOCK_CONVERSATIONS.find((x) => x.key === conv.key).state = action === "close" ? "closed" : "open";
      list().push({
        id: list().at(-1).id + 1,
        sender: "system",
        text: action === "close" ? `گفتگو توسط پشتیبانی بسته شد: ${reason}` : "گفتگو دوباره باز شد.",
        created_at: new Date().toISOString(),
      });
      sync();
    },
  };
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
const SENDER_PREFIX = { user: "", support: "شما: ", system: "سیستم: " };

export default function AdminConversationsPage() {
  const [filter, setFilter] = useUrlParam("filter", "waiting", FILTERS.map((f) => f.key));
  const [kind, setKind] = useUrlParam("kind", "all", KINDS.map((k) => k.key));
  const [selectedKey, setSelectedKey] = useUrlParam("c", "");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(toLatinDigits(searchInput).replace(/-/g, ""));

  const [items, setItems] = useState([]);
  const [waitingCount, setWaitingCount] = useState(null);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [toast, showToast] = useToast();

  // گفتگوی انتخاب‌شده را جدا نگه می‌داریم، چون بعد از جواب دادن ممکن است از
  // لیست «منتظر پاسخ ما» بیرون برود ولی هنوز باید باز بماند
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s === "ready" ? "ready" : "loading"));
    fetchInbox({ filter, kind, search })
      .then((data) => {
        if (cancelled) return;
        setItems(data.results);
        setWaitingCount(data.waiting);
        setState("ready");
        if (selectedKey && !selected) setSelected(data.results.find((c) => c.key === selectedKey) ?? null);
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, kind, search, reload]);

  function open(c) {
    setSelected(c);
    setSelectedKey(c.key);
    setItems((list) => list.map((x) => (x.key === c.key ? { ...x, unread_count: 0 } : x)));
  }

  function close() {
    setSelected(null);
    setSelectedKey("");
  }

  const onChanged = () => {
    setReload((k) => k + 1);
    notifyCountsChanged();
  };

  const queuePane = (
    <>
      <div className="shrink-0 space-y-3 border-b border-gray-100 p-4">
        <h1 className="text-lg font-bold text-gray-900">گفتگوها</h1>
        <SearchBox id="conv-search" value={searchInput} onChange={setSearchInput} placeholder="نام کاربر، عنوان کتاب یا شابک" />
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} counts={{ waiting: waitingCount }} label="وضعیت گفتگو" />
        <FilterChips options={KINDS} value={kind} onChange={setKind} label="نوع گفتگو" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && <QueueSkeleton />}
        {state === "error" && (
          <div className="m-4 flex items-center justify-between rounded-xl bg-red-50 p-3 text-sm text-red-700">
            لیست دریافت نشد.
            <button type="button" onClick={() => setReload((k) => k + 1)} className="font-semibold hover:underline">تلاش دوباره</button>
          </div>
        )}
        {state === "ready" && items.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-gray-500">
            {filter === "waiting" && !search ? "🎉 کسی منتظر پاسخ نیست." : "گفتگویی با این فیلتر پیدا نشد."}
          </p>
        )}
        <ul className="divide-y divide-gray-100">
          {items.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => open(c)}
                aria-current={c.key === selected?.key ? "true" : undefined}
                className={`w-full p-3 text-right focus:outline-none focus-visible:bg-blue-50 ${c.key === selected?.key ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${c.unread_count ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>{c.user.full_name}</p>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-400">
                    {/* برای فیلتر «منتظر پاسخ ما» این زمان یعنی «چقدر منتظر مانده» */}
                    {timeAgo(c.last_message.created_at)}
                    <CountPill n={c.unread_count} label={`${toFaNumber(c.unread_count)} پیام خوانده‌نشده`} />
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-500">
                  <Badge tone={c.kind === "entry" ? "blue" : "gray"}>{c.kind === "entry" ? "درخواست" : "بارگذاری"}</Badge>
                  <span dir="auto" className="truncate">{c.context.title}</span>
                  {c.state === "closed" && <Badge tone="red">بسته</Badge>}
                </p>
                <p className={`mt-1 truncate text-sm ${c.unread_count ? "text-gray-900" : "text-gray-500"}`}>
                  <span className="text-gray-400">{SENDER_PREFIX[c.last_message.sender]}</span>
                  {c.last_message.text}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  const detailPane = !selected ? (
    <EmptyDetail text="گفتگویی را از لیست انتخاب کنید." />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* کارت زمینه: این گفتگو دربارهٔ چیست، و لینک به جای اصلی‌اش */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <button type="button" onClick={close} className="text-sm font-medium text-gray-600 hover:text-gray-900 lg:hidden">→</button>
        <Badge tone={selected.kind === "entry" ? "blue" : "gray"}>{selected.kind === "entry" ? "درخواست" : "بارگذاری"}</Badge>
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-sm font-semibold text-gray-900">{selected.context.title}</p>
          <p className="text-xs text-gray-500">
            <span dir="ltr" className="font-mono">{displayIsbn(selected.context.isbn)}</span> · {selected.context.status_label}
          </p>
        </div>
        <a
          href={
            selected.kind === "entry"
              ? `/admin/requests?request=${selected.context.request_id}&entry=${selected.id}`
              : `/admin/books?book=${selected.context.book_id}`
          }
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
        >
          {selected.kind === "entry" ? "باز کردن درخواست ←" : "باز کردن کتاب ←"}
        </a>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <AdminConversationPanel
          key={selected.key}
          api={conversationApi(selected, onChanged)}
          title={`گفتگو با ${selected.user.full_name}`}
          onToast={showToast}
        />
      </div>
    </div>
  );

  return (
    <AdminShell active="conversations">
      <QueueLayout hasSelection={Boolean(selected)} queue={queuePane} detail={detailPane} />
      <Toast toast={toast} />
    </AdminShell>
  );
}
