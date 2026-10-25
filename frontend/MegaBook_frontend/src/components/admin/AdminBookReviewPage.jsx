import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  conversationApi, createCategory, getAdminBook, getAdminCategories, getAdminTags, getBookQueue, saveAdminBook,
} from "../../api/admin";
import { getBookFileLink } from "../../api/catalog";
import AdminShell from "./AdminShell";
import AdminConversationPanel from "./AdminConversationPanel";
import {
  BackToQueue, Cover, CountPill, EmptyDetail, FilterChips, QueueLayout, QueueSkeleton, SearchBox, Toast,
  displayIsbn, errorMessage, fieldErrors, formatDateTime, notifyCountsChanged, openSignedLink, timeAgo, toFaNumber,
  toLatinDigits, useDebounced, useToast, useUrlParam,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «بررسی کتاب‌ها»
//
// چیدمان سه‌قسمتی (روی صفحهٔ عریض):
//   منوی کناری | صف کتاب‌ها | فرم ویرایش و گفتگو با بارگذارنده
// روی موبایل صف و جزئیات دو «صفحه» می‌شوند: با انتخاب کتاب، جزئیات باز
// می‌شود و دکمهٔ برگشت دوباره صف را نشان می‌دهد.
//
// کتاب انتخاب‌شده و فیلتر در آدرس صفحه‌اند (/admin/books?status=pending&book=50)
// تا رفرش صفحه یا فرستادن لینک به ادمین دیگر همان کتاب را باز کند.
//
// منوی کناری (AdminShell)، پنل گفتگو و ابزارهای مشترک در فایل‌های جدای همین
// پوشه‌اند، چون همهٔ بخش‌های ادمین از آن‌ها استفاده می‌کنند.
// ═════════════════════════════════════════════════════════════

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { key: "pending", label: "در انتظار بررسی" },
  { key: "approved", label: "در فروشگاه" },
  { key: "rejected", label: "ردشده" },
  { key: "all", label: "همه" },
];

const STATUS_OPTIONS = [
  { key: "pending", label: "در انتظار بررسی", hint: "کتاب در فروشگاه دیده نمی‌شود." },
  { key: "approved", label: "تأیید و انتشار", hint: "کتاب با قیمت تعیین‌شده در فروشگاه قرار می‌گیرد." },
  { key: "rejected", label: "رد", hint: "کتاب منتشر نمی‌شود و دلیل در گفتگو برای بارگذارنده فرستاده می‌شود." },
];

const STATUS_BADGE = {
  pending: { label: "در انتظار", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { label: "در فروشگاه", className: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "ردشده", className: "bg-red-50 text-red-700 ring-red-200" },
};


// ═════════════════════════════════════════════════════════════
// اتصال به بکند (api/admin.js؛ فقط is_staff، برای بقیه 404)
//
// GET   /admin-api/books/?status=&search=&page=  ← صف + pending_count
//       «در انتظار» از قدیمی به جدید (اول آمده، اول بررسی)، بقیه از جدید به قدیمی
// GET   /admin-api/books/<id>/                   ← همهٔ چیزی که فرم لازم دارد
// PATCH /admin-api/books/<id>/   { status, price, seller_share, description, category_id, tags, rejection_reason }
//
// قاعده‌ها را سرور خودش بررسی می‌کند (Book.save)؛ فرانت فقط برای بازخورد سریع:
//   • تأیید بدون قیمت ممنوع؛ و برای کتاب تأییدشده price >= seller_share (۳.۱۱)
//   • سهم بارگذارنده بعد از مذاکره در گفتگو از همین‌جا عوض می‌شود (۳.۱۳ و ۳.۱۴)
//   • رد بدون دلیل ممنوع؛ دلیل عیناً در گفتگو برای بارگذارنده فرستاده می‌شود.
//     با خروج از «رد»، دلیل پاک می‌شود
//   • tags نام است، نه id: برچسبی که وجود ندارد ساخته می‌شود
// اگر وضعیت عوض شود، سرور در همان تراکنش پیام system و اعلان بارگذارنده را می‌سازد، و
// تأیید، درخواست باز همین شابک را «تأمین‌شده» می‌کند و به هر درخواست‌کننده پیام و اعلان می‌دهد.
// ═════════════════════════════════════════════════════════════

async function fetchTaxonomy() {
  const [categories, tags] = await Promise.all([getAdminCategories(), getAdminTags()]);
  return { categories, tags: tags.map((t) => t.name) };
}

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════
// فرم از روی کتاب ساخته می‌شود. قیمت و سهم به‌صورت رشتهٔ ارقام لاتین نگه داشته
// می‌شوند («75000») تا خالی بودن قیمت («») از صفر («0» یعنی رایگان) جدا باشد.
function formFromBook(b) {
  return {
    status: b.status,
    price: b.price === null ? "" : String(b.price),
    seller_share: String(b.seller_share),
    description: b.description,
    category_id: b.category_id,
    tags: [...b.tags],
    rejection_reason: b.rejection_reason,
  };
}

function payloadFromForm(f) {
  return {
    status: f.status,
    price: f.price === "" ? null : Number(f.price),
    seller_share: Number(f.seller_share || 0),
    description: f.description.trim(),
    category_id: f.category_id,
    tags: f.tags,
    rejection_reason: f.status === "rejected" ? f.rejection_reason.trim() : "",
  };
}

// اعتبارسنجی سمت کلاینت؛ همان قاعده‌های سرور
function validate(form) {
  const e = {};
  const share = Number(form.seller_share || 0);
  if (form.status === "approved") {
    if (form.price === "") e.price = "برای انتشار، قیمت فروشگاه را وارد کنید.";
    else if (Number(form.price) < share)
      e.price = `قیمت نمی‌تواند از سهم بارگذارنده (${toFaNumber(share)} تومان) کمتر باشد.`;
  }
  if (form.status === "rejected" && !form.rejection_reason.trim()) e.rejection_reason = "دلیل رد را بنویسید.";
  return e;
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function AdminBookReviewPage() {
  const [status, setStatus] = useUrlParam("status", "pending", STATUS_FILTERS.map((f) => f.key));
  const [selectedId, setSelectedId] = useUrlParam("book", null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(toLatinDigits(searchInput).replace(/-/g, ""));

  const [queue, setQueue] = useState([]);
  const [queueCount, setQueueCount] = useState(null);
  const [queueState, setQueueState] = useState("loading"); // loading | ready | error
  const [queueReload, setQueueReload] = useState(0);
  const [pendingCount, setPendingCount] = useState(null);

  const [book, setBook] = useState(null); // نسخهٔ ذخیره‌شده در سرور
  const [form, setForm] = useState(null); // نسخهٔ در حال ویرایش
  const [detailState, setDetailState] = useState("idle"); // idle | loading | ready | notfound | error
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [taxonomy, setTaxonomy] = useState({ categories: [], tags: [] });
  const [toast, showToast] = useToast();

  // «تغییر ذخیره‌نشده» = فرم با نسخهٔ سرور فرق دارد. state جدا لازم نیست؛
  // هر رندر از روی همین دو مقدار حساب می‌شود.
  const dirty = useMemo(
    () => Boolean(book && form && JSON.stringify(payloadFromForm(form)) !== JSON.stringify(payloadFromForm(formFromBook(book)))),
    [book, form]
  );

  useEffect(() => {
    fetchTaxonomy().then(setTaxonomy).catch(() => {});
  }, []);

  // دستهٔ تازه از همین صفحه (فقط ادمین؛ کاربران دسته نمی‌سازند)
  async function addCategory(name) {
    const created = await createCategory(name);
    setTaxonomy((tx) => ({ ...tx, categories: [...tx.categories, created].sort((a, b) => a.name.localeCompare(b.name, "fa")) }));
    return created;
  }

  // ── صف ──
  useEffect(() => {
    let cancelled = false;
    setQueueState((s) => (s === "ready" ? "ready" : "loading")); // بعد از ذخیره، لیست قبلی را پاک نکن
    getBookQueue({ status, search, page: 1 })
      .then((data) => {
        if (cancelled) return;
        setQueue(data.results);
        setQueueCount(data.count);
        setPendingCount(data.pending_count);
        setQueueState("ready");
      })
      .catch(() => !cancelled && setQueueState("error"));
    return () => {
      cancelled = true;
    };
  }, [status, search, queueReload]);

  // ── جزئیات کتاب انتخاب‌شده ──
  useEffect(() => {
    if (!selectedId) {
      setDetailState("idle");
      return;
    }
    let cancelled = false;
    setDetailState("loading");
    setErrors({});
    getAdminBook(selectedId)
      .then((b) => {
        if (cancelled) return;
        setBook(b);
        setForm(formFromBook(b));
        setDetailState("ready");
        // باز شدن کتاب پیام‌هایش را «خوانده» می‌کند؛ عدد آبی صف هم باید برود
        setQueue((q) => q.map((x) => (x.id === b.id ? { ...x, unread_count: 0 } : x)));
      })
      .catch((err) => !cancelled && setDetailState(err.response?.status === 404 ? "notfound" : "error"));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── هشدار مرورگر اگر با تغییر ذخیره‌نشده صفحه را ببندد یا رفرش کند ──
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // هر جابه‌جایی که فرم فعلی را کنار می‌گذارد از این دروازه رد می‌شود
  function confirmDiscard() {
    return !dirty || window.confirm("تغییرهای این کتاب ذخیره نشده‌اند. بدون ذخیره ادامه می‌دهید؟");
  }

  function selectBook(id) {
    if (id === selectedId || !confirmDiscard()) return;
    setSelectedId(id);
  }

  function closeDetail() {
    if (confirmDiscard()) setSelectedId(null);
  }

  async function handleSave({ goNext = false } = {}) {
    const clientErrors = validate(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;

    // کتاب بعدی را قبل از ذخیره پیدا می‌کنیم، چون بعد از ذخیره ممکن است
    // همین کتاب از صف «در انتظار» بیرون برود و جایش در لیست گم شود.
    const others = queue.filter((q) => q.id !== book.id);
    const index = queue.findIndex((q) => q.id === book.id);
    const nextId = goNext ? (queue.slice(index + 1)[0] ?? others[0])?.id ?? null : null;

    setSaving(true);
    try {
      const saved = await saveAdminBook(book.id, payloadFromForm(form));
      setBook(saved);
      setForm(formFromBook(saved));
      setErrors({});
      setQueueReload((k) => k + 1);
      setTaxonomy((tx) => ({ ...tx, tags: Array.from(new Set([...tx.tags, ...saved.tags])) }));
      notifyCountsChanged();
      showToast("تغییرها ذخیره شد.");
      if (nextId) setSelectedId(nextId);
    } catch (err) {
      if (err.response?.status === 400) {
        const next = fieldErrors(err.response.data);
        setErrors(next);
        // A rule the form doesn't show next to a field (e.g. an ISBN conflict on status)
        if (next.status || next.detail) showToast(next.status || next.detail, "red");
      } else showToast(errorMessage(err, "ذخیره ناموفق بود. اتصال را بررسی کنید."), "red");
    } finally {
      setSaving(false);
    }
  }

  const updateForm = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      Object.keys(patch).forEach((k) => delete next[k]);
      return next;
    });
  };

  // api گفتگوی همین کتاب برای پنل مشترک
  const panelApi = book && conversationApi("upload", book.id);

  const queuePane = (
    <>
      <div className="shrink-0 space-y-3 border-b border-gray-100 p-4">
        <h1 className="text-lg font-bold text-gray-900">بررسی کتاب‌ها</h1>
        <SearchBox id="queue-search" value={searchInput} onChange={setSearchInput} placeholder="عنوان، شابک یا نام بارگذارنده" />
        <FilterChips
          options={STATUS_FILTERS}
          value={status}
          onChange={(v) => v !== status && setStatus(v)}
          counts={{ pending: pendingCount }}
          label="فیلتر وضعیت"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {queueState === "loading" && <QueueSkeleton />}
        {queueState === "error" && (
          <div className="m-4 flex items-center justify-between rounded-xl bg-red-50 p-3 text-sm text-red-700">
            صف دریافت نشد.
            <button type="button" onClick={() => setQueueReload((k) => k + 1)} className="font-semibold hover:underline">
              تلاش دوباره
            </button>
          </div>
        )}
        {queueState === "ready" && queue.length === 0 && (
          <div className="px-6 py-12 text-center">
            <div className="text-3xl" aria-hidden="true">{status === "pending" && !search ? "🎉" : "🔎"}</div>
            <p className="mt-2 text-sm text-gray-500">{status === "pending" && !search ? "کتابی منتظر بررسی نیست." : "کتابی با این فیلتر پیدا نشد."}</p>
          </div>
        )}
        {queueState === "ready" && queue.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {queue.map((q) => (
              <QueueItem key={q.id} item={q} selected={q.id === selectedId} onSelect={() => selectBook(q.id)} />
            ))}
          </ul>
        )}
      </div>
      {queueState === "ready" && queueCount > PAGE_SIZE && (
        // صف روزانه معمولاً کوتاه است؛ برای بقیه جستجو کافی است
        <p className="shrink-0 border-t border-gray-100 p-3 text-center text-xs text-gray-500">
          {toFaNumber(PAGE_SIZE)} مورد از {toFaNumber(queueCount)}؛ برای بقیه جستجو کنید.
        </p>
      )}
    </>
  );

  let detailPane;
  if (detailState === "idle") detailPane = <EmptyDetail text="کتابی را از صف انتخاب کنید." />;
  else if (detailState === "loading") detailPane = <DetailSkeleton />;
  else if (detailState === "notfound" || detailState === "error")
    detailPane = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-gray-500">{detailState === "notfound" ? "این کتاب پیدا نشد." : "بارگذاری کتاب ناموفق بود."}</p>
        <button type="button" onClick={closeDetail} className="text-sm font-semibold text-blue-600 hover:underline">برگشت به صف</button>
      </div>
    );
  else
    detailPane = (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
        {/* فرم ویرایش */}
        <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <div className="mx-auto max-w-2xl p-4 lg:p-6">
            <BackToQueue onClick={closeDetail} label="صف کتاب‌ها" />
            <BookSummary book={book} onOpenFile={() => openSignedLink(() => getBookFileLink(book.id)).catch(() => showToast("فایل باز نشد.", "red"))} />
            <BookEditor
              book={book}
              form={form}
              errors={errors}
              taxonomy={taxonomy}
              onChange={updateForm}
              onAddCategory={addCategory}
              showToast={showToast}
            />

            {/* نوار ذخیره؛ پایین ستون فرم می‌چسبد */}
            <div className="sticky bottom-0 -mx-4 mt-6 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
              <p className="ml-auto text-xs text-gray-500" aria-live="polite">{dirty ? "تغییر ذخیره‌نشده دارید" : "همهٔ تغییرها ذخیره شده"}</p>
              <button type="button" onClick={() => setForm(formFromBook(book))} disabled={!dirty || saving} className="h-10 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-40">
                لغو تغییرها
              </button>
              <button type="button" onClick={() => handleSave()} disabled={!dirty || saving} className="h-10 rounded-lg px-4 text-sm font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 disabled:opacity-40">
                ذخیره
              </button>
              <button
                type="button"
                onClick={() => handleSave({ goNext: true })}
                disabled={!dirty || saving}
                className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                ذخیره و کتاب بعدی
              </button>
            </div>
          </div>
        </div>

        {/* گفتگو: روی صفحهٔ خیلی عریض کنار فرم، وگرنه زیر آن */}
        <div className="h-[32rem] shrink-0 border-t border-gray-200 xl:h-auto xl:w-96 xl:border-r xl:border-t-0">
          {/* وضعیت کتاب در key: بعد از تغییر وضعیت، پیام system تازه همان لحظه دیده شود */}
          <AdminConversationPanel
            key={`${book.id}:${book.status}`}
            api={panelApi}
            title={`گفتگو با ${book.uploaded_by.full_name}`}
            onToast={showToast}
            onChanged={notifyCountsChanged}
          />
        </div>
      </div>
    );

  return (
    <AdminShell active="books">
      <QueueLayout hasSelection={Boolean(selectedId)} queue={queuePane} detail={detailPane} />
      <Toast toast={toast} />
    </AdminShell>
  );
}

// ═════════════════════════════════════════════════════════════
// کامپوننت‌های داخلی این صفحه
// ═════════════════════════════════════════════════════════════

function QueueItem({ item, selected, onSelect }) {
  const badge = STATUS_BADGE[item.status];
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full gap-3 p-3 text-right transition-colors focus:outline-none focus-visible:bg-blue-50 ${
          selected ? "bg-blue-50" : "hover:bg-gray-50"
        }`}
      >
        <Cover src={item.cover} className="h-16 w-11" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p dir="auto" className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
            <CountPill n={item.unread_count} label={`${toFaNumber(item.unread_count)} پیام خوانده‌نشده`} />
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">{item.uploaded_by.full_name}</p>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-400">
            <span className={`rounded-full px-1.5 py-0.5 font-medium ring-1 ${badge.className}`}>{badge.label}</span>
            <span>{timeAgo(item.created_at)}</span>
          </div>
        </div>
      </button>
    </li>
  );
}

function BookSummary({ book, onOpenFile }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <Cover src={book.cover} className="h-32 w-[5.5rem]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 dir="auto" className="text-lg font-bold leading-snug text-gray-900">{book.title}</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_BADGE[book.status].className}`}>
            {STATUS_BADGE[book.status].label}
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-gray-500">نویسنده</dt>
          <dd dir="auto" className="text-gray-900">{book.authors}</dd>
          {book.publisher && (
            <>
              <dt className="text-gray-500">ناشر</dt>
              <dd dir="auto" className="text-gray-900">{book.publisher}</dd>
            </>
          )}
          <dt className="text-gray-500">شابک</dt>
          <dd dir="ltr" className="text-right font-mono text-gray-900">{displayIsbn(book.isbn)}</dd>
          <dt className="text-gray-500">بارگذارنده</dt>
          <dd className="text-gray-900">
            <Link to={`/admin/users?user=${book.uploaded_by.id}`} className="hover:text-blue-700 hover:underline">
              {book.uploaded_by.full_name}
            </Link>
          </dd>
          <dt className="text-gray-500">زمان بارگذاری</dt>
          <dd className="text-gray-900">{formatDateTime(book.created_at)}</dd>
          {book.status === "approved" && (
            <>
              <dt className="text-gray-500">فروشگاه</dt>
              <dd><Link to={`/books/${book.id}`} className="text-blue-700 hover:underline">صفحهٔ کتاب ←</Link></dd>
            </>
          )}
        </dl>
        <button
          type="button"
          onClick={onOpenFile}
          disabled={!book.has_file}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
        >
          <span aria-hidden="true">📄</span>
          باز کردن فایل PDF{book.page_count ? ` (${toFaNumber(book.page_count)} صفحه)` : ""}
        </button>
      </div>
    </div>
  );
}

function BookEditor({ book, form, errors, taxonomy, onChange, onAddCategory, showToast }) {
  const price = form.price === "" ? null : Number(form.price);
  const share = Number(form.seller_share || 0);
  const megabookShare = price === null ? null : price - share;
  const leavingStore = book.status === "approved" && form.status !== "approved";

  return (
    <div className="mt-4 space-y-4">
      {/* ── وضعیت ── */}
      <fieldset className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <legend className="px-1 text-sm font-bold text-gray-900">وضعیت</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {STATUS_OPTIONS.map((opt) => {
            const checked = form.status === opt.key;
            const tone = { pending: "amber", approved: "green", rejected: "red" }[opt.key];
            const ring = { amber: "ring-amber-400 bg-amber-50", green: "ring-green-500 bg-green-50", red: "ring-red-500 bg-red-50" }[tone];
            return (
              <label
                key={opt.key}
                className={`cursor-pointer rounded-xl p-3 ring-1 transition-colors ${checked ? `ring-2 ${ring}` : "ring-gray-200 hover:bg-gray-50"}`}
              >
                <input
                  type="radio"
                  name="status"
                  value={opt.key}
                  checked={checked}
                  onChange={() => onChange({ status: opt.key })}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold text-gray-900">{opt.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-500">{opt.hint}</span>
              </label>
            );
          })}
        </div>

        {/* تأیید → تأمین خودکار درخواست‌ها */}
        {form.status === "approved" && book.status !== "approved" && book.open_request_count > 0 && (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {toFaNumber(book.open_request_count)} نفر این کتاب را درخواست داده‌اند. با انتشار، درخواستشان خودکار «تأمین‌شده» می‌شود.
          </p>
        )}

        {leavingStore && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            کتاب از فروشگاه برداشته می‌شود. کسانی که قبلاً خریده‌اند همچنان به آن دسترسی دارند.
          </p>
        )}

        {form.status === "rejected" && (
          <div className="mt-3">
            <label htmlFor="rejection_reason" className="mb-1 block text-sm font-medium text-gray-700">دلیل رد</label>
            <textarea
              id="rejection_reason"
              rows={3}
              value={form.rejection_reason}
              onChange={(e) => onChange({ rejection_reason: e.target.value })}
              aria-invalid={Boolean(errors.rejection_reason)}
              aria-describedby="rejection_reason_hint"
              placeholder="مثلاً: فایل ناقص است، یا حق نشر رعایت نشده است."
              className={`w-full rounded-xl border p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                errors.rejection_reason ? "border-red-400" : "border-gray-300 focus:border-blue-600"
              }`}
            />
            <p id="rejection_reason_hint" className={`mt-1 text-xs ${errors.rejection_reason ? "text-red-600" : "text-amber-700"}`}>
              {errors.rejection_reason || "⚠️ این متن عیناً در گفتگو برای بارگذارنده فرستاده می‌شود."}
            </p>
          </div>
        )}
      </fieldset>

      {/* ── قیمت ── */}
      <fieldset className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <legend className="px-1 text-sm font-bold text-gray-900">قیمت</legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="seller_share" className="text-xs text-gray-500">سهم بارگذارنده از هر فروش</label>
            <MoneyInput
              id="seller_share"
              value={form.seller_share}
              invalid={Boolean(errors.seller_share)}
              onChange={(v) => onChange({ seller_share: v || "0" })}
            />
          </div>
          <div>
            <label htmlFor="price" className="text-xs text-gray-500">قیمت فروشگاه</label>
            <MoneyInput id="price" value={form.price} invalid={Boolean(errors.price)} onChange={(v) => onChange({ price: v })} />
          </div>
          <div>
            <p className="text-xs text-gray-500">سهم مگابوک</p>
            {/* همان لحظه حساب می‌شود؛ منفی یعنی قیمت از سهم کمتر است */}
            <p
              className={`mt-1 flex h-11 items-center rounded-xl px-3 text-sm font-semibold ${
                megabookShare === null ? "bg-gray-50 text-gray-400" : megabookShare < 0 ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
              }`}
            >
              {megabookShare === null ? "—" : `${megabookShare < 0 ? "−" : ""}${toFaNumber(Math.abs(megabookShare))} تومان`}
            </p>
          </div>
        </div>
        <p id="price_hint" className={`mt-2 text-xs ${errors.price ? "text-red-600" : "text-gray-500"}`}>
          {errors.price || errors.seller_share ||
            (book.uploaded_by_staff
              ? "کتاب ادمین سهم بارگذارنده ندارد (کل مبلغ مال مگابوک است). صفر یعنی کتاب رایگان است."
              : "صفر یعنی کتاب رایگان است. سهم را بعد از توافق در گفتگو با بارگذارنده عوض کنید؛ تغییر فقط روی فروش‌های بعدی اثر دارد.")}
        </p>
      </fieldset>

      {/* ── دسته‌بندی، برچسب‌ها، توضیحات ── */}
      <fieldset className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <legend className="px-1 text-sm font-bold text-gray-900">نمایش در فروشگاه</legend>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="category" className="block text-sm font-medium text-gray-700">دسته‌بندی</label>
            <NewCategory onAdd={onAddCategory} onCreated={(c) => onChange({ category_id: c.id })} showToast={showToast} />
          </div>
          <select
            id="category"
            value={form.category_id ?? ""}
            onChange={(e) => onChange({ category_id: e.target.value ? Number(e.target.value) : null })}
            className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          >
            <option value="">بدون دسته‌بندی</option>
            {taxonomy.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {form.status === "approved" && !form.category_id && (
            <p className="mt-1 text-xs text-amber-700">کتاب بدون دسته‌بندی فقط در تب «همه» صفحهٔ اصلی دیده می‌شود.</p>
          )}
        </div>

        <TagInput value={form.tags} suggestions={taxonomy.tags} onChange={(tags) => onChange({ tags })} />

        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">توضیحات کتاب</label>
          <textarea
            id="description"
            rows={6}
            dir="auto"
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
            className="w-full rounded-xl border border-gray-300 p-3 text-sm leading-7 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          />
        </div>
      </fieldset>
    </div>
  );
}

// مبلغ تومانی: ارقام فارسی نمایش داده می‌شوند، مقدار به‌صورت رشتهٔ ارقام لاتین نگه داشته می‌شود
function MoneyInput({ id, value, invalid, onChange }) {
  return (
    <div className="relative mt-1">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value === "" ? "" : toFaNumber(value)}
        onChange={(e) => onChange(toLatinDigits(e.target.value).replace(/\D/g, "").slice(0, 9))}
        aria-invalid={invalid}
        aria-describedby="price_hint"
        placeholder="—"
        className={`h-11 w-full rounded-xl border bg-white pl-14 pr-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
          invalid ? "border-red-400" : "border-gray-300 focus:border-blue-600"
        }`}
      />
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">تومان</span>
    </div>
  );
}

// «+ دستهٔ تازه» کنار منوی دسته‌بندی: بدون رفتن به صفحهٔ دسته‌ها و برچسب‌ها
function NewCategory({ onAdd, onCreated, showToast }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await onAdd(name.trim());
      onCreated(created);
      setName("");
      setOpen(false);
      showToast(`دستهٔ «${created.name}» ساخته شد.`);
    } catch (err) {
      showToast(errorMessage(err, "دسته ساخته نشد."), "red");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-blue-700 hover:underline">
        ＋ دستهٔ تازه
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <label htmlFor="new-category" className="sr-only">نام دستهٔ تازه</label>
      <input
        id="new-category"
        autoFocus
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="h-8 w-36 rounded-lg border border-gray-300 px-2 text-xs focus:border-blue-600 focus:outline-none"
      />
      <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white disabled:opacity-40">
        ساختن
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-8 px-1 text-xs text-gray-500">انصراف</button>
    </form>
  );
}

// ورودی برچسب: برچسب‌های انتخاب‌شده به‌صورت چیپ، و پیشنهاد از برچسب‌های موجود.
// برچسب تازه با Enter ساخته می‌شود (سرور با get_or_create ذخیره‌اش می‌کند).
function TagInput({ value, suggestions, onChange }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  const q = text.trim();
  const matches = suggestions.filter((s) => !value.includes(s) && (!q || s.includes(q))).slice(0, 6);
  const canCreate = q && !value.includes(q) && !suggestions.includes(q);

  function add(tag) {
    const clean = tag.trim().replace(/^#/, "");
    if (!clean || value.includes(clean)) return;
    onChange([...value, clean]);
    setText("");
  }

  return (
    <div className="relative">
      <label htmlFor="tag-input" className="mb-1 block text-sm font-medium text-gray-700">برچسب‌ها</label>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-gray-300 bg-white p-1.5 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/30">
        {value.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-1.5 pr-2.5 text-xs text-blue-800">
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              aria-label={`حذف برچسب ${tag}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-blue-500 hover:bg-blue-200 hover:text-blue-900"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="tag-input"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // تأخیر کوتاه تا کلیک روی پیشنهاد قبل از بسته شدن لیست ثبت شود
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "،" || e.key === ",") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length ? "" : "برچسب بنویسید و Enter بزنید"}
          className="h-8 min-w-[8rem] flex-1 border-0 bg-transparent px-1.5 text-sm focus:outline-none"
        />
      </div>
      {open && (matches.length > 0 || canCreate) && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {matches.map((m) => (
            <li key={m}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(m)} className="w-full px-3 py-2 text-right text-sm hover:bg-gray-50">
                {m}
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(q)} className="w-full px-3 py-2 text-right text-sm text-blue-700 hover:bg-blue-50">
                ساختن برچسب «{q}»
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-pulse space-y-4 p-6" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="h-40 rounded-2xl bg-gray-200" />
      <div className="h-32 rounded-2xl bg-gray-200" />
      <div className="h-28 rounded-2xl bg-gray-200" />
    </div>
  );
}
