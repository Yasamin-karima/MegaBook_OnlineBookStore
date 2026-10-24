import { useEffect, useMemo, useState } from "react";
import AdminShell from "./AdminShell";
import AdminConversationPanel from "./AdminConversationPanel";
import {
  BackToQueue, Cover, CountPill, EmptyDetail, FilterChips, QueueLayout, QueueSkeleton, SearchBox, Toast,
  clone, displayIsbn, fieldErrors, formatDateTime, httpError, notifyCountsChanged, timeAgo, toFaNumber, toLatinDigits,
  useDebounced, useToast, useUrlParam, wait,
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

// ═════════════════════════════════════════════════════════════
// داده ماک (Mock)
// ═════════════════════════════════════════════════════════════
const HOUR = 60 * 60 * 1000;
const t = (h) => new Date(Date.now() - h * HOUR).toISOString();

const MOCK_CATEGORIES = [
  { id: 1, name: "داستان و رمان" },
  { id: 2, name: "سبک زندگی" },
  { id: 3, name: "علمی و دانشگاهی" },
  { id: 4, name: "فلسفه" },
  { id: 5, name: "تاریخ" },
];

let MOCK_TAGS = ["فلسفی", "پرفروش", "ادبیات انگلیس", "کلاسیک", "درسی", "برنامه‌نویسی", "ادبیات ایران"];

let MOCK_BOOKS = [
  {
    id: 50, isbn: "9786000000005", title: "مبانی شبکه‌های پیچیده", authors: "یاسمین کریمی", translators: "", publisher: "", cover: "",
    uploaded_by: { id: 3, full_name: "یاسمین کریمی" }, created_at: t(30), status: "pending",
    seller_share: 80000, price: null, description: "جزوهٔ کامل درس شبکه‌های پیچیده، شامل مدل‌های گراف تصادفی و شبکه‌های پویا.",
    category_id: 3, tags: ["درسی"], rejection_reason: "", page_count: 214, has_file: true,
    open_request_count: 0, unread_count: 1,
  },
  {
    id: 52, isbn: "9780140449235", title: "Beyond Good and Evil", authors: "Friedrich Nietzsche", translators: "", publisher: "Penguin Classics", cover: "https://covers.openlibrary.org/b/isbn/9780140449235-M.jpg",
    uploaded_by: { id: 8, full_name: "رضا محمدی" }, created_at: t(20), status: "pending",
    seller_share: 50000, price: null, description: "", category_id: null, tags: [], rejection_reason: "", page_count: 240, has_file: true,
    open_request_count: 4, unread_count: 0,
  },
  {
    id: 53, isbn: "9789643113445", title: "سمفونی مردگان", authors: "عباس معروفی", translators: "", publisher: "ققنوس", cover: "",
    uploaded_by: { id: 9, full_name: "مریم احمدی" }, created_at: t(6), status: "pending",
    seller_share: 0, price: null, description: "رمانی دربارهٔ خانواده‌ای در اردبیل.", category_id: 1, tags: ["ادبیات ایران"], rejection_reason: "", page_count: 352, has_file: true,
    open_request_count: 1, unread_count: 2,
  },
  {
    id: 54, isbn: "9780262033848", title: "Introduction to Algorithms", authors: "Cormen, Leiserson, Rivest, Stein", translators: "", publisher: "MIT Press", cover: "",
    uploaded_by: { id: 10, full_name: "علی رضایی" }, created_at: t(2), status: "pending",
    seller_share: 150000, price: null, description: "", category_id: null, tags: [], rejection_reason: "", page_count: 1312, has_file: true,
    open_request_count: 0, unread_count: 0,
  },
  {
    id: 42, isbn: "9786000000012", title: "یادداشت‌های من", authors: "یاسمین کریمی", translators: "", publisher: "", cover: "",
    uploaded_by: { id: 3, full_name: "یاسمین کریمی" }, created_at: t(500), status: "approved",
    seller_share: 60000, price: 75000, description: "مجموعه‌ای از یادداشت‌های کوتاه.", category_id: 2, tags: [], rejection_reason: "", page_count: 120, has_file: true,
    open_request_count: 0, unread_count: 0,
  },
  {
    id: 51, isbn: "9786000000029", title: "جزوهٔ جبر خطی", authors: "یاسمین کریمی", translators: "", publisher: "", cover: "",
    uploaded_by: { id: 3, full_name: "یاسمین کریمی" }, created_at: t(400), status: "rejected",
    seller_share: 0, price: null, description: "", category_id: 3, tags: ["درسی"], rejection_reason: "فایل PDF ناقص است؛ از صفحهٔ ۴۰ به بعد خالی است.", page_count: 90, has_file: true,
    open_request_count: 0, unread_count: 0,
  },
];

// گفتگوی هر کتاب. sender از دید ادمین: "user" (بارگذارنده)، "support" (ما)، "system"
const MOCK_MESSAGES = {
  50: [
    { id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(30), author: null },
    { id: 2, sender: "user", text: "سلام. اگر سهم ۸۰ هزار تومان زیاد است، می‌توانم کمترش کنم.", created_at: t(1), author: null },
  ],
  52: [{ id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(20), author: null }],
  53: [
    { id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(6), author: null },
    { id: 2, sender: "user", text: "این نسخه چاپ دوازدهم است.", created_at: t(5), author: null },
    { id: 3, sender: "user", text: "سهمی نمی‌خواهم؛ فقط می‌خواهم کتاب در دسترس باشد.", created_at: t(4.9), author: null },
  ],
  54: [{ id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(2), author: null }],
  42: [
    { id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(500), author: null },
    { id: 2, sender: "support", text: "با سهم ۶۰ هزار تومان موافقیم و قیمت فروشگاه ۷۵ هزار تومان شد.", created_at: t(480), author: "سارا" },
    { id: 3, sender: "system", text: "کتاب تأیید شد و در فروشگاه قرار گرفت.", created_at: t(478), author: null },
  ],
  51: [
    { id: 1, sender: "system", text: "کتاب بارگذاری شد و در انتظار بررسی است.", created_at: t(400), author: null },
    { id: 2, sender: "system", text: "کتاب رد شد: فایل PDF ناقص است؛ از صفحهٔ ۴۰ به بعد خالی است.", created_at: t(390), author: null },
  ],
};
let MOCK_CONV_STATE = { 50: "open", 52: "open", 53: "open", 54: "open", 42: "open", 51: "closed" };

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
  { key: "rejected", label: "رد", hint: "کتاب منتشر نمی‌شود و دلیل برای بارگذارنده فرستاده می‌شود." },
];

const STATUS_BADGE = {
  pending: { label: "در انتظار", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { label: "در فروشگاه", className: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "ردشده", className: "bg-red-50 text-red-700 ring-red-200" },
};


// ═════════════════════════════════════════════════════════════
// 🔌 اتصال به بکند
//
// همهٔ endpointهای /api/admin/ فقط برای is_staff کار می‌کنند. برای کاربر
// عادی 404 برگردانید، نه 403 (همان قاعدهٔ فایل‌های خصوصی، ۳.۱۵): 403 به
// کاربر می‌گوید «اینجا چیزی هست که اجازه‌اش را نداری».
// همهٔ ادمین‌ها به همه‌چیز دسترسی دارند؛ نقش جدا برای کارهای مالی نداریم.
// آدرس‌ها پیشنهادی‌اند.
// ═════════════════════════════════════════════════════════════

// GET /api/admin/books/?status=&search=&page=
// ترتیب: «در انتظار» از قدیمی به جدید (صف: اول آمده، اول بررسی)،
// بقیه از جدید به قدیمی.
async function fetchQueue({ status, search, page }) {
  await wait(500);
  const q = search.trim().toLowerCase();
  const rows = MOCK_BOOKS
    .filter((b) => status === "all" || b.status === status)
    .filter((b) => !q || b.title.toLowerCase().includes(q) || b.isbn.includes(q) || b.uploaded_by.full_name.includes(q))
    .sort((a, b) => (status === "pending" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  const start = (page - 1) * PAGE_SIZE;
  return {
    count: rows.length,
    next: start + PAGE_SIZE < rows.length ? page + 1 : null,
    results: clone(rows.slice(start, start + PAGE_SIZE)).map(({ id, title, isbn, cover, uploaded_by, created_at, status, unread_count }) => ({
      id, title, isbn, cover, uploaded_by, created_at, status, unread_count,
    })),
  };
}

// تعداد کتاب‌های در انتظار، برای عدد روی فیلتر «در انتظار بررسی».
// 🔌 همان عدد books در GET /api/admin/counts/ (منوی کناری) است.
async function fetchPendingCount() {
  await wait(200);
  return MOCK_BOOKS.filter((b) => b.status === "pending").length;
}

// GET /api/admin/books/<id>/
// open_request_count: تعداد درخواست‌کننده‌های BookRequest باز با همین شابک.
// (ادمین این عدد را می‌بیند؛ کاربران عادی در صفحهٔ درخواست نمی‌بینند.)
async function fetchBook(id) {
  await wait(400);
  const b = MOCK_BOOKS.find((x) => x.id === id);
  if (!b) throw httpError(404);
  return clone(b);
}

// GET /api/admin/categories/   و   GET /api/admin/tags/
async function fetchTaxonomy() {
  await wait(200);
  return { categories: clone(MOCK_CATEGORIES), tags: [...MOCK_TAGS] };
}

// PATCH /api/admin/books/<id>/
//   body: { status, price, description, category_id, tags: [نام‌ها], rejection_reason }
//
// قاعده‌هایی که سرور باید خودش بررسی کند (فرانت فقط برای بازخورد سریع):
//   • تأیید بدون قیمت ممنوع؛ و برای کتاب تأییدشده price >= seller_share (۳.۱۱)
//   • رد بدون دلیل ممنوع. با خروج از «رد»، دلیل پاک می‌شود (مثل BookRequest، ۵.۴)
//   • seller_share از اینجا قابل تغییر نیست (فیلد فقط‌خواندنی serializer)
//   • tags نام است، نه id: برچسبی که وجود ندارد با get_or_create ساخته می‌شود
//
// اگر status عوض شد، سرور در همان تراکنش:
//   • یک پیام system در گفتگوی کتاب می‌گذارد (برای رد: «کتاب رد شد: <دلیل>»)
//   • اگر تأیید شد و BookRequest بازی با همین شابک هست، آن را خودکار
//     «تأمین‌شده» می‌کند و در گفتگوی هر درخواست‌کننده پیام system می‌گذارد
//   • TODO(اعلان): اعلان «کتاب تأیید/رد شد» برای بارگذارنده
//   • TODO(اعلان): اعلان «درخواست شما تأمین شد» برای همهٔ درخواست‌کننده‌ها
//   (طبق تصمیم اعلان‌ها، این‌ها با صدا زدن صریح سرویس اعلان ساخته می‌شوند، نه با سیگنال)
//
// ⚠️ مدل Book هنوز فیلد rejection_reason ندارد؛ باید اضافه شود.
async function saveBook(id, payload) {
  await wait(800);
  const b = MOCK_BOOKS.find((x) => x.id === id);
  const errors = {};
  if (payload.status === "approved") {
    if (payload.price === null) errors.price = ["قیمت کتاب تأییدشده لازم است."];
    else if (payload.price < b.seller_share) errors.price = ["قیمت نمی‌تواند از سهم بارگذارنده کمتر باشد."];
  }
  if (payload.status === "rejected" && !payload.rejection_reason.trim()) errors.rejection_reason = ["دلیل رد لازم است."];
  if (Object.keys(errors).length) throw httpError(400, errors);

  const statusChanged = payload.status !== b.status;
  Object.assign(b, payload, { rejection_reason: payload.status === "rejected" ? payload.rejection_reason : "" });
  payload.tags.forEach((tag) => !MOCK_TAGS.includes(tag) && MOCK_TAGS.push(tag));

  if (statusChanged) {
    const list = MOCK_MESSAGES[id];
    const text = {
      approved: "کتاب تأیید شد و در فروشگاه قرار گرفت.",
      rejected: `کتاب رد شد: ${payload.rejection_reason}`,
      pending: "کتاب به وضعیت «در انتظار بررسی» برگشت.",
    }[payload.status];
    list.push({ id: list.at(-1).id + 1, sender: "system", text, created_at: new Date().toISOString(), author: null });
    if (payload.status === "approved") b.open_request_count = 0; // درخواست‌ها خودکار تأمین شدند
  }
  return clone(b);
}

// دریافت فایل: همان endpoint لینک امضاشدهٔ ۵ دقیقه‌ای (۳.۱۵)؛ ادمین اجازه دارد.
//   const res = await axios.get(`/catalog/books/${id}/file-link/`);
//   window.open(res.data.url, "_blank", "noopener");
async function openBookFile(id) {
  await wait(400);
  console.log("open file (mock):", id);
}

// GET  /api/admin/books/<id>/messages/?after=<id>   ← { messages, conversation_state }
// POST /api/admin/books/<id>/messages/               ← { text }  (پیام با نام «پشتیبانی مگابوک»)
// POST /api/admin/books/<id>/read/                   ← { last_message_id }
// POST /api/admin/books/<id>/conversation/close/     ← { reason }
// POST /api/admin/books/<id>/conversation/reopen/
//
// author: نام ادمینی که پیام را فرستاده. فقط ادمین‌ها می‌بینند؛
// کاربر همه را «پشتیبانی مگابوک» می‌بیند.
async function fetchMessages(id, after = 0) {
  await wait(300);
  return { messages: clone((MOCK_MESSAGES[id] ?? []).filter((m) => m.id > after)), conversation_state: MOCK_CONV_STATE[id] };
}

// TODO(اعلان): پاسخ پشتیبانی → اعلان برای بارگذارنده؛ یک اعلان برای هر گفتگو،
// نه برای هر پیام (اگر اعلان خوانده‌نشدهٔ همین گفتگو هست، همان به‌روز شود).
async function sendMessage(id, text) {
  await wait(600);
  if (MOCK_CONV_STATE[id] !== "open") throw httpError(409);
  const list = MOCK_MESSAGES[id];
  const msg = { id: list.at(-1).id + 1, sender: "support", text, created_at: new Date().toISOString(), author: "شما" };
  list.push(msg);
  return clone(msg);
}

async function markRead(id) {
  const b = MOCK_BOOKS.find((x) => x.id === id);
  if (b) b.unread_count = 0;
}

// بستن و بازگشایی ثبت می‌شوند: کدام ادمین، کی، با چه دلیلی (تصمیم تیکت‌ها).
// هر دو یک پیام system در گفتگو می‌گذارند تا کاربر هم ببیند.
async function setConversationState(id, action, reason = "") {
  await wait(500);
  MOCK_CONV_STATE[id] = action === "close" ? "closed" : "open";
  const list = MOCK_MESSAGES[id];
  list.push({
    id: list.at(-1).id + 1,
    sender: "system",
    text: action === "close" ? `گفتگو توسط پشتیبانی بسته شد: ${reason}` : "گفتگو دوباره باز شد.",
    created_at: new Date().toISOString(),
    author: null,
  });
}

// ═════════════════════════════════════════════════════════════
// توابع کمکی
// ═════════════════════════════════════════════════════════════
// فرم از روی کتاب ساخته می‌شود. قیمت به‌صورت رشتهٔ ارقام لاتین نگه داشته
// می‌شود («75000») تا خالی بودن («») از صفر («0» یعنی رایگان) جدا باشد.
function formFromBook(b) {
  return {
    status: b.status,
    price: b.price === null ? "" : String(b.price),
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
    description: f.description.trim(),
    category_id: f.category_id,
    tags: f.tags,
    rejection_reason: f.status === "rejected" ? f.rejection_reason.trim() : "",
  };
}

// اعتبارسنجی سمت کلاینت؛ همان قاعده‌های سرور
function validate(form, book) {
  const e = {};
  if (form.status === "approved") {
    if (form.price === "") e.price = "برای انتشار، قیمت فروشگاه را وارد کنید.";
    else if (Number(form.price) < book.seller_share)
      e.price = `قیمت نمی‌تواند از سهم بارگذارنده (${toFaNumber(book.seller_share)} تومان) کمتر باشد.`;
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

  // ── صف ──
  useEffect(() => {
    let cancelled = false;
    setQueueState((s) => (s === "ready" ? "ready" : "loading")); // بعد از ذخیره، لیست قبلی را پاک نکن
    Promise.all([fetchQueue({ status, search, page: 1 }), fetchPendingCount()])
      .then(([data, pending]) => {
        if (cancelled) return;
        setQueue(data.results);
        setQueueCount(data.count);
        setPendingCount(pending);
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
    fetchBook(selectedId)
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
    const clientErrors = validate(form, book);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;

    // کتاب بعدی را قبل از ذخیره پیدا می‌کنیم، چون بعد از ذخیره ممکن است
    // همین کتاب از صف «در انتظار» بیرون برود و جایش در لیست گم شود.
    const others = queue.filter((q) => q.id !== book.id);
    const index = queue.findIndex((q) => q.id === book.id);
    const nextId = goNext ? (queue.slice(index + 1)[0] ?? others[0])?.id ?? null : null;

    setSaving(true);
    try {
      const saved = await saveBook(book.id, payloadFromForm(form));
      setBook(saved);
      setForm(formFromBook(saved));
      setErrors({});
      setQueueReload((k) => k + 1);
      setTaxonomy((tx) => ({ ...tx, tags: Array.from(new Set([...tx.tags, ...saved.tags])) }));
      notifyCountsChanged();
      showToast("تغییرها ذخیره شد.");
      if (nextId) setSelectedId(nextId);
    } catch (err) {
      if (err.response?.status === 400) setErrors(fieldErrors(err.response.data));
      else showToast("ذخیره ناموفق بود. اتصال را بررسی کنید.", "red");
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
  const conversationApi = book && {
    load: (after) => fetchMessages(book.id, after),
    send: (text) => sendMessage(book.id, text),
    markRead: () => markRead(book.id),
    setState: (action, reason) => setConversationState(book.id, action, reason),
  };

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
        // 🔌 صفحه‌بندی کامل صف را وقتی لازم شد اضافه کنید؛ صف روزانه معمولاً کوتاه است
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
            <BookSummary book={book} onOpenFile={() => openBookFile(book.id).catch(() => showToast("فایل باز نشد.", "red"))} />
            <BookEditor book={book} form={form} errors={errors} taxonomy={taxonomy} onChange={updateForm} />

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
            api={conversationApi}
            title={`گفتگو با ${book.uploaded_by.full_name}`}
            onToast={showToast}
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
          {/* 🔌 بعد از ساخت بخش کاربران: لینک به صفحهٔ همین کاربر */}
          <dd className="text-gray-900">{book.uploaded_by.full_name}</dd>
          <dt className="text-gray-500">زمان بارگذاری</dt>
          <dd className="text-gray-900">{formatDateTime(book.created_at)}</dd>
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

function BookEditor({ book, form, errors, taxonomy, onChange }) {
  const price = form.price === "" ? null : Number(form.price);
  const megabookShare = price === null ? null : price - book.seller_share;
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
            <p className="text-xs text-gray-500">سهم بارگذارنده از هر فروش</p>
            <p className="mt-1 flex h-11 items-center rounded-xl bg-gray-50 px-3 text-sm font-semibold text-gray-900">
              {book.seller_share === 0 ? "بدون سهم" : `${toFaNumber(book.seller_share)} تومان`}
            </p>
          </div>
          <div>
            <label htmlFor="price" className="text-xs text-gray-500">قیمت فروشگاه</label>
            <div className="relative mt-1">
              <input
                id="price"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.price === "" ? "" : toFaNumber(form.price)}
                onChange={(e) => onChange({ price: toLatinDigits(e.target.value).replace(/\D/g, "").slice(0, 9) })}
                aria-invalid={Boolean(errors.price)}
                aria-describedby="price_hint"
                placeholder="—"
                className={`h-11 w-full rounded-xl border bg-white pl-14 pr-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
                  errors.price ? "border-red-400" : "border-gray-300 focus:border-blue-600"
                }`}
              />
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">تومان</span>
            </div>
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
          {errors.price || "صفر یعنی کتاب رایگان است. سهم بارگذارنده از اینجا تغییر نمی‌کند."}
        </p>
      </fieldset>

      {/* ── دسته‌بندی، برچسب‌ها، توضیحات ── */}
      <fieldset className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <legend className="px-1 text-sm font-bold text-gray-900">نمایش در فروشگاه</legend>

        <div>
          <label htmlFor="category" className="mb-1 block text-sm font-medium text-gray-700">دسته‌بندی</label>
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
