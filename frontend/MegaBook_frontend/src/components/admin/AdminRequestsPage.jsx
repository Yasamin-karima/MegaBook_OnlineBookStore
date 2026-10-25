import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { conversationApi, getAdminRequest, getRequestQueue, markRequestReviewed, saveAdminRequest } from "../../api/admin";
import AdminShell from "./AdminShell";
import AdminConversationPanel from "./AdminConversationPanel";
import {
  BackToQueue, Badge, Cover, CountPill, EmptyDetail, FilterChips, QueueLayout, QueueSkeleton, ReasonField, SearchBox, Toast,
  displayIsbn, errorMessage, fieldErrors, formatDateTime, notifyCountsChanged, timeAgo, toFaNumber, toLatinDigits,
  useDebounced, useToast, useUrlParam,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «درخواست‌ها»
//
// هر ردیف صف یک BookRequest است (یک ردیف برای هر شابک). در جزئیات:
//   • تغییر وضعیت در هر جهت (در انتظار تأمین ⇄ تأمین‌شده ⇄ ردشده) با دلیل رد
//   • لیست درخواست‌کننده‌ها (RequestEntryها)؛ هر کدام گفتگوی خودش را دارد
//   • دکمهٔ «بارگذاری این کتاب» که فرم بارگذاری را با همین شابک باز می‌کند
//
// «جدید» یعنی درخواست بازی که هنوز ادمینی آن را بررسی نکرده (BookRequest.reviewed_at
// خالی). با زدن «بررسی شد» (یا هر ذخیره‌ای) از این فیلتر بیرون می‌رود. اگر درخواست
// بسته‌شده‌ای دوباره «در انتظار تأمین» شود، reviewed_at می‌ماند.
// ═════════════════════════════════════════════════════════════

const STATUS_FILTERS = [
  { key: "new", label: "جدید" },
  { key: "open", label: "در انتظار تأمین" },
  { key: "fulfilled", label: "تأمین‌شده" },
  { key: "rejected", label: "ردشده" },
  { key: "all", label: "همه" },
];

const STATUS_OPTIONS = [
  { key: "open", label: "در انتظار تأمین", hint: "در تابلوی عمومی دیده می‌شود و کاربران می‌توانند کتاب را بارگذاری کنند." },
  { key: "fulfilled", label: "تأمین‌شده", hint: "معمولاً خودکار، وقتی کتابی با همین شابک تأیید شود. گفتگوها برای کاربر بسته می‌شوند." },
  { key: "rejected", label: "رد", hint: "از تابلو برداشته می‌شود و دیگر کسی نمی‌تواند این شابک را درخواست دهد." },
];

const STATUS_BADGE = {
  open: { label: "در انتظار تأمین", tone: "amber" },
  fulfilled: { label: "تأمین‌شده", tone: "green" },
  rejected: { label: "ردشده", tone: "red" },
};

// ═════════════════════════════════════════════════════════════
// اتصال به بکند (api/admin.js؛ فقط is_staff، برای بقیه 404)
//
// GET   /admin-api/book-requests/?filter=new|open|fulfilled|rejected|all&search=  ← صف + new_count
//       «جدید» و «در انتظار تأمین»: بیشترین درخواست‌کننده اول؛ بقیه از جدید به قدیمی
// GET   /admin-api/book-requests/<id>/  ← درخواست + کتاب هم‌شابک + درخواست‌کننده‌ها
// PATCH /admin-api/book-requests/<id>/  { status, rejection_reason }
//       همان قاعده‌های مدل (۵.۳ تا ۵.۵): رد بدون دلیل ممنوع؛ خروج از رد دلیل را پاک می‌کند.
//       هر ذخیره reviewed_at را هم پر می‌کند. با تغییر وضعیت، سرور در گفتگوی هر
//       درخواست‌کننده پیام system می‌گذارد؛ «تأمین‌شده» گفتگوها را برای کاربر می‌بندد،
//       «رد» باز می‌گذارد؛ و تأمین و رد برای هر درخواست‌کننده اعلان می‌سازند.
// POST  /admin-api/book-requests/<id>/mark-reviewed/  ← فقط reviewed_at
// گفتگوی هر RequestEntry (۵.۹): /admin-api/request-entries/<id>/conversation/…
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function AdminRequestsPage() {
  const [filter, setFilter] = useUrlParam("filter", "new", STATUS_FILTERS.map((f) => f.key));
  const [selectedId, setSelectedId] = useUrlParam("request", null);
  const [entryId, setEntryId] = useUrlParam("entry", null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(toLatinDigits(searchInput).replace(/-/g, ""));

  const [queue, setQueue] = useState([]);
  const [queueState, setQueueState] = useState("loading");
  const [queueReload, setQueueReload] = useState(0);
  const [newCount, setNewCount] = useState(null);

  const [request, setRequest] = useState(null);
  const [detailState, setDetailState] = useState("idle");
  const [form, setForm] = useState({ status: "open", rejection_reason: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    let cancelled = false;
    setQueueState((s) => (s === "ready" ? "ready" : "loading"));
    getRequestQueue({ filter, search })
      .then((data) => {
        if (cancelled) return;
        setQueue(data.results);
        setNewCount(data.new_count);
        setQueueState("ready");
      })
      .catch(() => !cancelled && setQueueState("error"));
    return () => {
      cancelled = true;
    };
  }, [filter, search, queueReload]);

  useEffect(() => {
    if (!selectedId) {
      setDetailState("idle");
      return;
    }
    let cancelled = false;
    setDetailState("loading");
    setErrors({});
    getAdminRequest(selectedId)
      .then((r) => {
        if (cancelled) return;
        setRequest(r);
        setForm({ status: r.status, rejection_reason: r.rejection_reason });
        setDetailState("ready");
      })
      .catch((err) => !cancelled && setDetailState(err.response?.status === 404 ? "notfound" : "error"));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const dirty = request && (form.status !== request.status || (form.status === "rejected" && form.rejection_reason.trim() !== request.rejection_reason));

  function selectRequest(id) {
    if (id === selectedId) return;
    if (dirty && !window.confirm("تغییرهای این درخواست ذخیره نشده‌اند. بدون ذخیره ادامه می‌دهید؟")) return;
    setSelectedId(id);
    setEntryId(null);
  }

  async function handleSave() {
    if (form.status === "rejected" && !form.rejection_reason.trim()) {
      setErrors({ rejection_reason: "دلیل رد را بنویسید." });
      return;
    }
    setSaving(true);
    try {
      const r = await saveAdminRequest(request.id, form);
      setRequest(r);
      setForm({ status: r.status, rejection_reason: r.rejection_reason });
      setErrors({});
      setQueueReload((k) => k + 1);
      notifyCountsChanged();
      showToast("ذخیره شد.");
    } catch (err) {
      if (err.response?.status === 400) setErrors(fieldErrors(err.response.data));
      else showToast(errorMessage(err, "ذخیره ناموفق بود."), "red");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkReviewed() {
    try {
      await markRequestReviewed(request.id);
      setRequest((r) => ({ ...r, reviewed_at: new Date().toISOString() }));
      setQueueReload((k) => k + 1);
      notifyCountsChanged();
      // درخواست بعدی صف «جدید» را باز کن
      const next = queue.find((q) => q.id !== request.id);
      if (filter === "new" && next) {
        setSelectedId(next.id);
        setEntryId(null);
      }
    } catch {
      showToast("انجام نشد.", "red");
    }
  }

  const selectedEntry = request?.entries.find((e) => e.id === entryId) ?? null;

  const queuePane = (
    <>
      <div className="shrink-0 space-y-3 border-b border-gray-100 p-4">
        <h1 className="text-lg font-bold text-gray-900">درخواست‌های کتاب</h1>
        <SearchBox id="req-search" value={searchInput} onChange={setSearchInput} placeholder="عنوان، نویسنده یا شابک" />
        <FilterChips options={STATUS_FILTERS} value={filter} onChange={setFilter} counts={{ new: newCount }} label="فیلتر وضعیت" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {queueState === "loading" && <QueueSkeleton />}
        {queueState === "error" && (
          <div className="m-4 flex items-center justify-between rounded-xl bg-red-50 p-3 text-sm text-red-700">
            لیست دریافت نشد.
            <button type="button" onClick={() => setQueueReload((k) => k + 1)} className="font-semibold hover:underline">تلاش دوباره</button>
          </div>
        )}
        {queueState === "ready" && queue.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-gray-500">
            {filter === "new" && !search ? "🎉 درخواست بررسی‌نشده‌ای نیست." : "درخواستی با این فیلتر پیدا نشد."}
          </p>
        )}
        <ul className="divide-y divide-gray-100">
          {queue.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => selectRequest(r.id)}
                aria-current={r.id === selectedId ? "true" : undefined}
                className={`flex w-full gap-3 p-3 text-right focus:outline-none focus-visible:bg-blue-50 ${r.id === selectedId ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <Cover src={r.cover} className="h-14 w-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p dir="auto" className="truncate text-sm font-semibold text-gray-900">{r.title}</p>
                    <CountPill n={r.unread_count} label={`${toFaNumber(r.unread_count)} پیام خوانده‌نشده`} />
                  </div>
                  <p dir="auto" className="truncate text-xs text-gray-500">{r.authors}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge>
                      <span className="font-semibold text-gray-600">{toFaNumber(r.requester_count)} نفر</span>
                    </span>
                    <span>{timeAgo(r.created_at)}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  let detailPane;
  if (detailState === "idle") detailPane = <EmptyDetail text="درخواستی را از لیست انتخاب کنید." />;
  else if (detailState === "loading") detailPane = <div className="m-6 h-64 animate-pulse rounded-2xl bg-gray-200" aria-busy="true" />;
  else if (detailState !== "ready")
    detailPane = <EmptyDetail text={detailState === "notfound" ? "این درخواست پیدا نشد." : "بارگذاری ناموفق بود."} />;
  else
    detailPane = (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
        <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-4 p-4 lg:p-6">
            <BackToQueue onClick={() => (!dirty || window.confirm("تغییرها ذخیره نشده‌اند. ادامه می‌دهید؟")) && setSelectedId(null)} label="لیست درخواست‌ها" />

            {/* ── مشخصات ── */}
            <div className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <Cover src={request.cover} className="h-28 w-20" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 dir="auto" className="text-lg font-bold text-gray-900">{request.title}</h2>
                  <Badge tone={STATUS_BADGE[request.status].tone}>{STATUS_BADGE[request.status].label}</Badge>
                </div>
                <p dir="auto" className="text-sm text-gray-600">{request.authors}</p>
                <p className="mt-1 text-xs text-gray-500">
                  شابک <span dir="ltr" className="font-mono">{displayIsbn(request.isbn)}</span> · اولین درخواست {formatDateTime(request.created_at)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {request.book_in_store ? (
                    <Link to={`/books/${request.book_in_store.id}`} className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 ring-1 ring-green-200">
                      کتاب در فروشگاه است ←
                    </Link>
                  ) : request.book_in_review ? (
                    <Link to={`/admin/books?book=${request.book_in_review.id}`} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      کتابی با این شابک منتظر بررسی است ←
                    </Link>
                  ) : (
                    // فرم بارگذاری ادمین با همین شابک؛ کتاب ادمین مستقیم تأیید می‌شود
                    // و این درخواست خودکار تأمین می‌شود
                    <Link to={`/books/new?isbn=${request.isbn}`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                      بارگذاری این کتاب
                    </Link>
                  )}
                  {request.status === "open" && !request.reviewed_at && (
                    <button type="button" onClick={handleMarkReviewed} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50">
                      ✓ بررسی شد، باز بماند
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── وضعیت ── */}
            <fieldset className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <legend className="px-1 text-sm font-bold text-gray-900">وضعیت درخواست</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {STATUS_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className={`cursor-pointer rounded-xl p-3 ring-1 ${
                      form.status === opt.key ? "bg-blue-50 ring-2 ring-blue-500" : "ring-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input type="radio" name="req-status" value={opt.key} checked={form.status === opt.key} onChange={() => setForm((f) => ({ ...f, status: opt.key }))} className="sr-only" />
                    <span className="block text-sm font-semibold text-gray-900">{opt.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-gray-500">{opt.hint}</span>
                  </label>
                ))}
              </div>
              {form.status === "fulfilled" && request.status !== "fulfilled" && !request.book_in_store && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  هنوز کتابی با این شابک در فروشگاه نیست. درخواست‌کننده‌ها پیام «تأمین شد» می‌گیرند ولی کتابی برای خرید پیدا نمی‌کنند.
                </p>
              )}
              {form.status === "rejected" && (
                <div className="mt-3">
                  <ReasonField
                    id="req-reason"
                    label="دلیل رد"
                    value={form.rejection_reason}
                    onChange={(v) => {
                      setForm((f) => ({ ...f, rejection_reason: v }));
                      setErrors({});
                    }}
                    error={errors.rejection_reason}
                    warning={`⚠️ این متن برای هر ${toFaNumber(request.entries.length)} درخواست‌کننده فرستاده می‌شود، و هر کس بعداً این شابک را درخواست دهد هم آن را می‌بیند.`}
                    placeholder="مثلاً: ناشر اجازهٔ انتشار نسخهٔ الکترونیکی را نداده است."
                  />
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setForm({ status: request.status, rejection_reason: request.rejection_reason })} disabled={!dirty || saving} className="h-10 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                  لغو
                </button>
                <button type="button" onClick={handleSave} disabled={!dirty || saving} className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300">
                  {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                  ذخیرهٔ وضعیت
                </button>
              </div>
            </fieldset>

            {/* ── درخواست‌کننده‌ها ── */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-900">
                درخواست‌کننده‌ها ({toFaNumber(request.entries.length)})
              </h3>
              <ul className="divide-y divide-gray-100">
                {request.entries.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEntryId(e.id);
                        setRequest((r) => ({ ...r, entries: r.entries.map((x) => (x.id === e.id ? { ...x, unread_count: 0 } : x)) }));
                      }}
                      aria-current={e.id === entryId ? "true" : undefined}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-right ${e.id === entryId ? "bg-blue-50" : "hover:bg-gray-50"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">
                            {e.user.full_name}
                            {e.conversation.state === "closed" && <span className="mr-1.5"><Badge tone="gray">بسته</Badge></span>}
                          </p>
                          <span className="text-[11px] text-gray-400">{timeAgo(e.created_at)}</span>
                        </div>
                        {e.note && <p className="mt-0.5 text-xs leading-5 text-gray-600">«{e.note}»</p>}
                      </div>
                      <CountPill n={e.unread_count} label={`${toFaNumber(e.unread_count)} پیام خوانده‌نشده`} />
                      <span className="text-xs text-blue-600">گفتگو</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        {/* گفتگوی درخواست‌کنندهٔ انتخاب‌شده */}
        <div className="h-[32rem] shrink-0 border-t border-gray-200 xl:h-auto xl:w-96 xl:border-r xl:border-t-0">
          {selectedEntry ? (
            // وضعیت درخواست در key است: با تغییر وضعیت، سرور پیام system می‌گذارد و
            // پنل از نو ساخته می‌شود تا آن پیام همان لحظه دیده شود (نه ۱۵ ثانیه بعد)
            <AdminConversationPanel
              key={`${selectedEntry.id}:${request.status}`}
              api={conversationApi("entry", selectedEntry.id)}
              title={`گفتگو با ${selectedEntry.user.full_name}`}
              subtitle={
                <Link to={`/admin/users?user=${selectedEntry.user.id}`} className="hover:text-blue-700 hover:underline">
                  مشاهدهٔ کاربر · پیام‌های شما با نام «پشتیبانی مگابوک» دیده می‌شوند.
                </Link>
              }
              onToast={showToast}
              onChanged={notifyCountsChanged}
            />
          ) : (
            <EmptyDetail text="برای دیدن گفتگو، یک درخواست‌کننده را انتخاب کنید." />
          )}
        </div>
      </div>
    );

  return (
    <AdminShell active="requests">
      <QueueLayout hasSelection={Boolean(selectedId)} queue={queuePane} detail={detailPane} />
      <Toast toast={toast} />
    </AdminShell>
  );
}
