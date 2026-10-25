import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { conversationApi, getInbox, getInboxItem } from "../../api/admin";
import AdminShell from "./AdminShell";
import AdminConversationPanel from "./AdminConversationPanel";
import {
  Badge, CountPill, EmptyDetail, FilterChips, QueueLayout, QueueSkeleton, SearchBox, Toast,
  displayIsbn, notifyCountsChanged, timeAgo, toFaNumber, toLatinDigits, useDebounced, useToast, useUrlParam,
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
// هر دو نوع گفتگو در یک مدل‌اند (Conversation)، پس شناسهٔ خود گفتگو در آدرس است
// (?c=12). هر ردیف kind ("entry" | "upload") و parent_id دارد تا پنل گفتگو به
// endpointهای همان والد برود (همان‌هایی که بخش درخواست‌ها و بررسی کتاب‌ها استفاده می‌کنند).
// ═════════════════════════════════════════════════════════════

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
// اتصال به بکند (api/admin.js؛ فقط is_staff)
//
// GET /admin-api/conversations/?filter=waiting|open|closed|all&kind=all|entry|upload&search=
//     ← صف + waiting_count. آخرین پیام و خوانده‌نشده با Subquery در همان کوئری.
// GET /admin-api/conversations/<id>/ ← یک ردیف، برای گفتگویی که با لینک باز شده ولی در
//     فیلتر فعلی نیست.
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
const SENDER_PREFIX = { user: "", support: "پشتیبانی: ", system: "سیستم: " };

// همان api پنل، با این تفاوت که بعد از پاسخ، لیست دوباره خوانده می‌شود (گفتگو از
// «منتظر پاسخ ما» بیرون می‌رود) و عدد منو به‌روز می‌شود
function inboxApi(conversation, onChanged) {
  const api = conversationApi(conversation.kind, conversation.parent_id);
  return {
    ...api,
    send: (text) => api.send(text).then((message) => (onChanged(), message)),
    markRead: () => api.markRead().then(onChanged),
  };
}

export default function AdminConversationsPage() {
  const [filter, setFilter] = useUrlParam("filter", "waiting", FILTERS.map((f) => f.key));
  const [kind, setKind] = useUrlParam("kind", "all", KINDS.map((k) => k.key));
  const [selectedKey, setSelectedKey] = useUrlParam("c", null);
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
    getInbox({ filter, kind, search })
      .then((data) => {
        if (cancelled) return;
        setItems(data.results);
        setWaitingCount(data.waiting_count);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [filter, kind, search, reload]);

  // گفتگویی که در آدرس است (لینک اعلان یا رفرش) ولی هنوز باز نشده؛ ممکن است در
  // فیلتر فعلی نباشد، پس جدا گرفته می‌شود
  useEffect(() => {
    if (!selectedKey || selected?.id === selectedKey) return;
    let cancelled = false;
    getInboxItem(selectedKey)
      .then((c) => !cancelled && setSelected(c))
      .catch(() => !cancelled && setSelectedKey(null));
    return () => {
      cancelled = true;
    };
  }, [selectedKey, selected, setSelectedKey]);

  function open(c) {
    setSelected(c);
    setSelectedKey(c.id);
    setItems((list) => list.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x)));
  }

  function close() {
    setSelected(null);
    setSelectedKey(null);
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
            <li key={c.id}>
              <button
                type="button"
                onClick={() => open(c)}
                aria-current={c.id === selected?.id ? "true" : undefined}
                className={`w-full p-3 text-right focus:outline-none focus-visible:bg-blue-50 ${c.id === selected?.id ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${c.unread_count ? "font-bold text-gray-900" : "font-semibold text-gray-800"}`}>{c.user.full_name}</p>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-400">
                    {/* برای فیلتر «منتظر پاسخ ما» این زمان یعنی «چقدر منتظر مانده» */}
                    {c.last_message && timeAgo(c.last_message.created_at)}
                    <CountPill n={c.unread_count} label={`${toFaNumber(c.unread_count)} پیام خوانده‌نشده`} />
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-500">
                  <Badge tone={c.kind === "entry" ? "blue" : "gray"}>{c.kind === "entry" ? "درخواست" : "بارگذاری"}</Badge>
                  <span dir="auto" className="truncate">{c.context.title}</span>
                  {c.state === "closed" && <Badge tone="red">بسته</Badge>}
                </p>
                {c.last_message && (
                  <p className={`mt-1 truncate text-sm ${c.unread_count ? "text-gray-900" : "text-gray-500"}`}>
                    <span className="text-gray-400">{SENDER_PREFIX[c.last_message.sender]}</span>
                    {c.last_message.text}
                  </p>
                )}
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
        <Link
          to={
            selected.kind === "entry"
              ? `/admin/requests?filter=all&request=${selected.context.request_id}&entry=${selected.parent_id}`
              : `/admin/books?status=all&book=${selected.context.book_id}`
          }
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
        >
          {selected.kind === "entry" ? "باز کردن درخواست ←" : "باز کردن کتاب ←"}
        </Link>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <AdminConversationPanel
          key={selected.id}
          api={inboxApi(selected, onChanged)}
          title={`گفتگو با ${selected.user.full_name}`}
          onToast={showToast}
          onChanged={onChanged}
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
