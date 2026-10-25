import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  approveTopup, completeWithdrawal, createAdjustment, getAdjustments, getAdminUsers, getTopups, getWithdrawals,
  rejectTopup, rejectWithdrawal,
} from "../../api/admin";
import { getReceiptLink } from "../../api/wallet";
import AdminShell from "./AdminShell";
import {
  Badge, ConfirmDialog, EmptyDetail, FilterChips, QueueLayout, QueueSkeleton, ReasonField, SearchBox, Toast,
  displayCard, errorMessage, formatDateTime, notifyCountsChanged, openSignedLink, timeAgo, toFaNumber, toLatinDigits,
  useDebounced, useToast, useUrlParam,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «کیف پول»
//
// سه تب:
//   شارژهای کارت‌به‌کارت ← TopUpRequest: تأیید (واریز به کیف پول) یا رد با دلیل
//   برداشت‌ها             ← WithdrawalRequest: «پرداخت شد» (completed) یا رد با دلیل (برگشت پول)
//   اصلاح دستی            ← services.adjust: مثبت یا منفی، با توضیح اجباری
//
// قاعده‌های اصلی (تصمیم‌های ۶.۹ تا ۶.۱۱):
//   • «تأییدشده / ردشده / پرداخت‌شده» نهایی‌اند. هیچ دکمه‌ای وضعیت نهایی را
//     برنمی‌گرداند؛ اشتباه فقط با «اصلاح دستی» درست می‌شود.
//   • برای همین هر دکمهٔ مالی یک پنجرهٔ تأیید دارد که مبلغ و نام کاربر را
//     دوباره نشان می‌دهد. فوکوس پیش‌فرض آن پنجره روی «انصراف» است.
//   • فرانت هیچ عددی را حساب و ذخیره نمی‌کند؛ همهٔ جابه‌جایی‌ها فقط از
//     wallet/services.py در بکند انجام می‌شوند (۶.۷).
// ═════════════════════════════════════════════════════════════

const TABS = [
  { key: "topups", label: "شارژ کارت‌به‌کارت" },
  { key: "withdrawals", label: "برداشت‌ها" },
  { key: "adjust", label: "اصلاح دستی" },
];

const TOPUP_FILTERS = [
  { key: "pending", label: "در انتظار" },
  { key: "approved", label: "تأییدشده" },
  { key: "rejected", label: "ردشده" },
  { key: "all", label: "همه" },
];
const WITHDRAW_FILTERS = [
  { key: "pending", label: "در انتظار" },
  { key: "completed", label: "پرداخت‌شده" },
  { key: "rejected", label: "ردشده" },
  { key: "all", label: "همه" },
];
const STATUS_BADGE = {
  pending: { label: "در انتظار", tone: "amber" },
  approved: { label: "تأییدشده", tone: "green" },
  completed: { label: "پرداخت‌شده", tone: "green" },
  rejected: { label: "ردشده", tone: "red" },
};

// ═════════════════════════════════════════════════════════════
// اتصال به بکند (api/admin.js؛ فقط is_staff، بدون نقش مالی جدا)
//
// GET  /admin-api/wallet/topups/?status=&search=       ← صف + pending { topups, withdrawals }
// GET  /admin-api/wallet/withdrawals/?status=&search=
//      «در انتظار» از قدیمی به جدید (صف)، بقیه از جدید به قدیمی. موجودی کاربر در هر ردیف.
// POST …/topups/<id>/approve/ | reject/ {reason}
// POST …/withdrawals/<id>/complete/ | reject/ {reason}
//      سرور ردیف را قفل می‌کند، دوباره بررسی می‌کند هنوز «در انتظار» است و فقط یک بار
//      واریز می‌کند. اگر ادمین دیگری همین لحظه آن را بررسی کرده باشد → 409.
//      رد برداشت تراکنش برگشت می‌سازد. اعلان کاربر را سرور می‌سازد (wallet.services).
// GET/POST /admin-api/wallet/adjustments/  { user_id, amount (علامت‌دار), description }
//      services.adjust: توضیح اجباری، ادمین ثبت می‌شود، موجودی منفی نمی‌شود → 400.
// ═════════════════════════════════════════════════════════════

function fetchList(kind, params) {
  return kind === "topups" ? getTopups(params) : getWithdrawals(params);
}

async function decide(kind, id, action, reason) {
  if (kind === "topups") return action === "approve" ? approveTopup(id) : rejectTopup(id, reason);
  return action === "paid" ? completeWithdrawal(id) : rejectWithdrawal(id, reason);
}

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function AdminWalletPage() {
  const [tab, setTab] = useUrlParam("tab", "topups", TABS.map((x) => x.key));
  const [pending, setPending] = useState({});
  const [toast, showToast] = useToast();

  return (
    <AdminShell active="wallet">
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 pt-4">
        <h1 className="text-lg font-bold text-gray-900">کیف پول</h1>
        <div role="tablist" className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={`flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium ${
                tab === x.key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {x.label}
              {pending[x.key] > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-gray-900">{toFaNumber(pending[x.key])}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* key: با عوض شدن تب، state تب قبلی (انتخاب، فیلتر جستجو) کامل پاک می‌شود */}
      {tab === "adjust" ? (
        <AdjustTab key="adjust" showToast={showToast} />
      ) : (
        <RequestsTab key={tab} kind={tab} onPending={setPending} showToast={showToast} />
      )}
      <Toast toast={toast} />
    </AdminShell>
  );
}

// ─────────────────────────────────────────────────────────────
// تب شارژ و برداشت: صف + جزئیات + دکمه‌های تصمیم
// ─────────────────────────────────────────────────────────────
function RequestsTab({ kind, onPending, showToast }) {
  const isTopup = kind === "topups";
  const filters = isTopup ? TOPUP_FILTERS : WITHDRAW_FILTERS;
  const [status, setStatus] = useState("pending");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(toLatinDigits(searchInput));
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("loading");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState(null);

  // پنجرهٔ تأیید: { action: "approve" | "paid" | "reject" }
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s === "ready" ? "ready" : "loading"));
    fetchList(kind, { status, search })
      .then((data) => {
        if (cancelled) return;
        setRows(data.results);
        onPending(data.pending);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [kind, status, search, reload, onPending]);

  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (selectedId) setSelected((cur) => rows.find((r) => r.id === selectedId) ?? cur);
  }, [rows, selectedId]);

  function select(r) {
    setSelectedId(r.id);
    setSelected(r);
  }

  function openDialog(action) {
    setDialog({ action });
    setReason("");
    setReasonError("");
  }

  async function confirm() {
    if (dialog.action === "reject" && !reason.trim()) {
      setReasonError("دلیل رد را بنویسید.");
      return;
    }
    setBusy(true);
    try {
      const updated = await decide(kind, selected.id, dialog.action, reason);
      setSelected(updated);
      setDialog(null);
      setReload((k) => k + 1);
      notifyCountsChanged();
      showToast(
        { approve: "شارژ تأیید و به کیف پول واریز شد.", paid: "برداشت «پرداخت‌شده» ثبت شد.", reject: isTopup ? "درخواست شارژ رد شد." : "برداشت رد شد و مبلغ به کیف پول برگشت." }[dialog.action]
      );
      // مورد بعدی صف «در انتظار»
      const next = rows.find((r) => r.id !== selected.id && r.status === "pending");
      if (status === "pending" && next) select(next);
    } catch (err) {
      setDialog(null);
      if (err.response?.status === 409) {
        showToast("این درخواست همین حالا توسط ادمین دیگری بررسی شد.", "red");
        setReload((k) => k + 1);
      } else if (err.response?.status === 400) {
        setReasonError(err.response.data.reason?.[0] ?? "اطلاعات نامعتبر است.");
      } else showToast(errorMessage(err), "red");
    } finally {
      setBusy(false);
    }
  }

  const queuePane = (
    <>
      <div className="shrink-0 space-y-3 border-b border-gray-100 p-4">
        <SearchBox
          id={`${kind}-search`}
          value={searchInput}
          onChange={setSearchInput}
          placeholder={isTopup ? "نام، ایمیل، موبایل یا شمارهٔ پیگیری" : "نام، ایمیل یا موبایل"}
        />
        <FilterChips options={filters} value={status} onChange={setStatus} label="فیلتر وضعیت" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && <QueueSkeleton />}
        {state === "error" && (
          <div className="m-4 flex items-center justify-between rounded-xl bg-red-50 p-3 text-sm text-red-700">
            لیست دریافت نشد.
            <button type="button" onClick={() => setReload((k) => k + 1)} className="font-semibold hover:underline">تلاش دوباره</button>
          </div>
        )}
        {state === "ready" && rows.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-gray-500">{status === "pending" ? "🎉 درخواستی منتظر نیست." : "موردی پیدا نشد."}</p>
        )}
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => select(r)}
                aria-current={r.id === selectedId ? "true" : undefined}
                className={`flex w-full items-center gap-3 p-3 text-right ${r.id === selectedId ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{r.user.full_name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{timeAgo(r.created_at)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-bold text-gray-900">{toFaNumber(r.amount)} <span className="text-xs font-normal text-gray-500">تومان</span></span>
                  <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  const detailPane = !selected ? (
    <EmptyDetail text="درخواستی را از لیست انتخاب کنید." />
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-4 p-4 lg:p-6">
        <button type="button" onClick={() => { setSelected(null); setSelectedId(null); }} className="text-sm font-medium text-gray-600 lg:hidden">→ لیست</button>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-500">{isTopup ? "مبلغ واریزی گزارش‌شده" : "مبلغ برداشت"}</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{toFaNumber(selected.amount)} <span className="text-base font-medium text-gray-500">تومان</span></p>
            </div>
            <Badge tone={STATUS_BADGE[selected.status].tone}>{STATUS_BADGE[selected.status].label}</Badge>
          </div>

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-gray-100 pt-4 text-sm">
            <dt className="text-gray-500">کاربر</dt>
            <dd className="font-semibold text-gray-900">
              <Link to={`/admin/users?user=${selected.user.id}`} className="hover:text-blue-700 hover:underline">{selected.user.full_name}</Link>
            </dd>
            <dt className="text-gray-500">موجودی فعلی</dt>
            <dd className="text-gray-900">{toFaNumber(selected.user.balance)} تومان</dd>
            {isTopup ? (
              <>
                <dt className="text-gray-500">شمارهٔ پیگیری</dt>
                <dd dir="ltr" className="text-right font-mono text-gray-900">{selected.tracking_number}</dd>
                <dt className="text-gray-500">زمان واریز</dt>
                <dd className="text-gray-900">{formatDateTime(selected.deposited_at)}</dd>
                <dt className="text-gray-500">رسید</dt>
                <dd>
                  {selected.has_receipt ? (
                    <button type="button" onClick={() => openSignedLink(() => getReceiptLink(selected.id)).catch(() => showToast("رسید باز نشد.", "red"))} className="font-semibold text-blue-600 hover:underline">
                      مشاهدهٔ رسید
                    </button>
                  ) : (
                    <span className="text-gray-400">بارگذاری نشده</span>
                  )}
                </dd>
              </>
            ) : (
              <>
                {/* نام کامل درشت کنار شمارهٔ کارت: پیش از واریز بررسی کنید که صاحب کارت همین کاربر است (۶.۱۰) */}
                <dt className="self-center text-gray-500">شمارهٔ کارت</dt>
                <dd className="rounded-xl bg-gray-50 p-3">
                  <p dir="ltr" className="text-right font-mono text-lg tracking-wider text-gray-900">{displayCard(selected.card_number)}</p>
                  <p className="mt-1 text-xs text-gray-500">صاحب کارت باید <b className="text-gray-900">{selected.user.full_name}</b> باشد.</p>
                </dd>
              </>
            )}
            <dt className="text-gray-500">ثبت درخواست</dt>
            <dd className="text-gray-900">{formatDateTime(selected.created_at)}</dd>
            {selected.reviewed_by && (
              <>
                <dt className="text-gray-500">بررسی‌کننده</dt>
                <dd className="text-gray-900">{selected.reviewed_by}</dd>
              </>
            )}
            {selected.status === "rejected" && (
              <>
                <dt className="text-gray-500">دلیل رد</dt>
                <dd className="text-red-700">{isTopup ? selected.rejection_reason : selected.admin_note}</dd>
              </>
            )}
          </dl>
        </div>

        {selected.status === "pending" ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => openDialog("reject")} className="h-11 rounded-xl px-5 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">
              رد…
            </button>
            <button
              type="button"
              onClick={() => openDialog(isTopup ? "approve" : "paid")}
              className="h-11 rounded-xl bg-green-600 px-5 text-sm font-semibold text-white hover:bg-green-700"
            >
              {isTopup ? "تأیید و واریز…" : "پرداخت کردم…"}
            </button>
          </div>
        ) : (
          <p className="rounded-xl bg-gray-100 p-3 text-center text-xs leading-6 text-gray-600">
            این وضعیت نهایی است و تغییر نمی‌کند. اگر اشتباهی شده، از تب «اصلاح دستی» جبران کنید.
          </p>
        )}
      </div>
    </div>
  );

  const dialogContent = dialog && selected && {
    approve: {
      title: "تأیید شارژ",
      tone: "green",
      label: "تأیید و واریز",
      body: (
        <p>
          <b>{toFaNumber(selected.amount)} تومان</b> به کیف پول <b>{selected.user.full_name}</b> واریز می‌شود. پیش از تأیید، این مبلغ را با شمارهٔ پیگیری{" "}
          <span dir="ltr" className="font-mono">{selected.tracking_number}</span> در صورت‌حساب بانک پیدا کرده باشید.
        </p>
      ),
    },
    paid: {
      title: "ثبت پرداخت برداشت",
      tone: "green",
      label: "بله، پرداخت کردم",
      body: (
        <p>
          تأیید می‌کنید که <b>{toFaNumber(selected.amount)} تومان</b> را به کارت{" "}
          <span dir="ltr" className="font-mono">{displayCard(selected.card_number ?? "")}</span> به نام <b>{selected.user.full_name}</b> واریز کرده‌اید؟
        </p>
      ),
    },
    reject: {
      title: isTopup ? "رد درخواست شارژ" : "رد برداشت",
      tone: "red",
      label: "رد درخواست",
      body: (
        <>
          {!isTopup && <p>مبلغ <b>{toFaNumber(selected.amount)} تومان</b> به کیف پول {selected.user.full_name} برمی‌گردد.</p>}
          <ReasonField id="wallet-reason" label="دلیل رد" value={reason} onChange={(v) => { setReason(v); setReasonError(""); }} error={reasonError} />
        </>
      ),
    },
  }[dialog.action];

  return (
    <>
      <QueueLayout hasSelection={Boolean(selected)} queue={queuePane} detail={detailPane} />
      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialogContent?.title}
        tone={dialogContent?.tone}
        confirmLabel={dialogContent?.label}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setDialog(null)}
      >
        {dialogContent?.body}
        <p className="text-xs text-gray-500">این کار برگشت‌پذیر نیست.</p>
      </ConfirmDialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// تب اصلاح دستی
// ─────────────────────────────────────────────────────────────
function AdjustTab({ showToast }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [results, setResults] = useState([]);
  const [user, setUser] = useState(null);
  const [direction, setDirection] = useState("credit"); // credit = افزایش، debit = کاهش
  const [amount, setAmount] = useState(""); // ارقام لاتین
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    getAdjustments().then((data) => setHistory(data.results)).catch(() => {});
  }, []);

  // همان جستجوی بخش کاربران (نام، ایمیل یا موبایل)
  useEffect(() => {
    let cancelled = false;
    const q = toLatinDigits(debounced).trim();
    if (!q) return;
    getAdminUsers({ search: q }).then((r) => !cancelled && setResults(r.results.slice(0, 8))).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const signed = (direction === "debit" ? -1 : 1) * Number(amount || 0);
  const after = user ? user.balance + signed : null;

  function review(e) {
    e.preventDefault();
    const next = {};
    if (!user) next.user = "کاربر را انتخاب کنید.";
    if (!Number(amount)) next.amount = "مبلغ را وارد کنید.";
    else if (after < 0) next.amount = `موجودی کاربر ${toFaNumber(user.balance)} تومان است و منفی نمی‌شود.`;
    if (!description.trim()) next.description = "توضیح لازم است؛ در دفتر تراکنش‌ها و برای کاربر ثبت می‌شود.";
    setErrors(next);
    if (!Object.keys(next).length) setConfirming(true);
  }

  async function submit() {
    setBusy(true);
    try {
      const { adjustment, balance } = await createAdjustment({ user_id: user.id, amount: signed, description: description.trim() });
      setHistory((h) => [adjustment, ...h]);
      // موجودی تازه از سرور، نه جمع زدن در فرانت
      setUser((u) => ({ ...u, balance }));
      setAmount("");
      setDescription("");
      setConfirming(false);
      showToast("اصلاح ثبت شد.");
    } catch (err) {
      setConfirming(false);
      const data = err.response?.data ?? {};
      if (err.response?.status === 400)
        setErrors({ amount: data.amount?.[0], description: data.description?.[0], user: data.user_id?.[0] });
      else showToast(errorMessage(err, "ثبت نشد."), "red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-6">
        <form onSubmit={review} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-bold text-gray-900">اصلاح دستی موجودی</h2>
            <p className="mt-1 text-xs leading-6 text-gray-500">
              فقط برای جبران اشتباه (مثلاً شارژی که نباید تأیید می‌شد). یک ردیف «اصلاح» در دفتر ثبت می‌شود و ردیف‌های قبلی دست نمی‌خورند.
            </p>
          </div>

          {/* انتخاب کاربر */}
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">کاربر</p>
            {user ? (
              <div className="flex items-center justify-between rounded-xl bg-blue-50 p-3 ring-1 ring-blue-200">
                <div>
                  <p className="font-semibold text-gray-900">{user.full_name}</p>
                  <p className="text-xs text-gray-600">موجودی: {toFaNumber(user.balance)} تومان</p>
                </div>
                <button type="button" onClick={() => setUser(null)} className="text-xs font-semibold text-blue-700 hover:underline">تغییر</button>
              </div>
            ) : (
              <>
                <SearchBox id="adjust-user" value={query} onChange={setQuery} placeholder="نام، ایمیل یا موبایل" />
                {query.trim() && results.length > 0 && (
                  <ul className="mt-1 divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {results.map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => { setUser(u); setQuery(""); setErrors({}); }} className="flex w-full justify-between px-3 py-2 text-right text-sm hover:bg-gray-50">
                          <span>{u.full_name}</span>
                          <span dir="ltr" className="text-xs text-gray-400">{u.email || u.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {errors.user && <p className="mt-1 text-xs text-red-600">{errors.user}</p>}
              </>
            )}
          </div>

          {/* جهت و مبلغ */}
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">نوع اصلاح</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "credit", label: "افزایش موجودی" },
                { key: "debit", label: "کاهش موجودی" },
              ].map((d) => (
                <label key={d.key} className={`cursor-pointer rounded-xl p-2.5 text-center text-sm ring-1 ${direction === d.key ? (d.key === "credit" ? "bg-green-50 font-semibold text-green-800 ring-2 ring-green-500" : "bg-red-50 font-semibold text-red-800 ring-2 ring-red-500") : "ring-gray-200 hover:bg-gray-50"}`}>
                  <input type="radio" name="direction" className="sr-only" checked={direction === d.key} onChange={() => setDirection(d.key)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="adjust-amount" className="mb-1 block text-sm font-medium text-gray-700">مبلغ (تومان)</label>
            <input
              id="adjust-amount"
              inputMode="numeric"
              value={amount ? toFaNumber(amount) : ""}
              onChange={(e) => { setAmount(toLatinDigits(e.target.value).replace(/\D/g, "").slice(0, 10)); setErrors((x) => ({ ...x, amount: undefined })); }}
              className={`h-11 w-full rounded-xl border px-3 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${errors.amount ? "border-red-400" : "border-gray-300 focus:border-blue-600"}`}
            />
            {errors.amount ? (
              <p className="mt-1 text-xs text-red-600">{errors.amount}</p>
            ) : (
              user && Number(amount) > 0 && <p className="mt-1 text-xs text-gray-500">موجودی بعد از اصلاح: {toFaNumber(after)} تومان</p>
            )}
          </div>
          <ReasonField
            id="adjust-desc"
            label="توضیح"
            value={description}
            onChange={(v) => { setDescription(v); setErrors((x) => ({ ...x, description: undefined })); }}
            error={errors.description}
            warning="در دفتر تراکنش‌ها کنار نام شما ثبت می‌شود و کاربر هم آن را در تراکنش‌هایش می‌بیند."
            placeholder="مثلاً: جبران خطای قیمت در سفارش ۵۰۱"
          />
          <button type="submit" className="h-11 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">بررسی و ثبت…</button>
        </form>

        {/* اصلاح‌های اخیر */}
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="border-b border-gray-100 px-5 py-3 font-bold text-gray-900">اصلاح‌های اخیر</h2>
          {history.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">هنوز اصلاحی ثبت نشده.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map((h) => (
                <li key={h.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">{h.user.full_name}</p>
                    <span dir="ltr" className={`text-sm font-bold ${h.amount > 0 ? "text-green-600" : "text-red-600"}`}>
                      {h.amount > 0 ? "+" : "−"}{toFaNumber(Math.abs(h.amount))}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-gray-600">{h.description}</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">{h.created_by} · {formatDateTime(h.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirming}
        title="ثبت اصلاح دستی"
        tone={direction === "credit" ? "green" : "red"}
        confirmLabel="ثبت اصلاح"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      >
        {user && (
          <>
            <p>
              <b>{toFaNumber(Number(amount))} تومان</b> {direction === "credit" ? "به" : "از"} کیف پول <b>{user.full_name}</b> {direction === "credit" ? "اضافه" : "کم"} می‌شود.
              موجودی از {toFaNumber(user.balance)} به <b>{toFaNumber(after)}</b> تومان می‌رسد.
            </p>
            <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">«{description.trim()}»</p>
            <p className="text-xs text-gray-500">این ردیف از دفتر پاک نمی‌شود؛ اگر اشتباه بود، با یک اصلاح دیگر جبران کنید.</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
