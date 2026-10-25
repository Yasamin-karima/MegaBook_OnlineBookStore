import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminUser, getAdminUsers } from "../../api/admin";
import AdminShell from "./AdminShell";
import {
  Badge, EmptyDetail, QueueLayout, QueueSkeleton, SearchBox,
  formatDate, formatDateTime, toFaNumber, toLatinDigits, useDebounced, useUrlParam,
} from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «کاربران» (فقط خواندنی)
//
// هیچ چیزی از اینجا ویرایش نمی‌شود. کاربرد اصلی این صفحه جواب دادن به
// سؤال‌هایی مثل «پولم کجا رفت؟» یا «کتابی که خریدم کو؟» است: ادمین کاربر را
// پیدا می‌کند و موجودی، تراکنش‌ها، خریدها، بارگذاری‌ها و درخواست‌هایش را
// یک‌جا می‌بیند. هر مورد به بخش مربوطش در داشبورد لینک می‌شود.
//
// ⚠️ این صفحه ایمیل، موبایل و تراکنش‌های همهٔ کاربران را نشان می‌دهد؛ endpoint
// آن فقط برای is_staff است (برای بقیه 404). فهرست عمومی کاربران قبلاً به همین
// دلیل حذف شد (۲.۹). همهٔ عددها (موجودی، تعدادها) در سرور حساب می‌شوند، نه ذخیره.
// ═════════════════════════════════════════════════════════════

const LEDGER_LABEL = {
  topup: "شارژ",
  purchase: "خرید",
  sale_income: "سهم فروش",
  commission: "کمیسیون",
  withdrawal: "برداشت",
  withdrawal_reversal: "برگشت برداشت",
  adjustment: "اصلاح دستی",
};
const BOOK_STATUS = { pending: ["در انتظار", "amber"], approved: ["در فروشگاه", "green"], rejected: ["ردشده", "red"] };
const REQUEST_STATUS = { open: ["در انتظار تأمین", "amber"], fulfilled: ["تأمین‌شده", "green"], rejected: ["ردشده", "red"] };

// ═════════════════════════════════════════════════════════════
// اتصال به بکند (api/admin.js؛ فقط is_staff، فقط خواندنی)
//
// GET /admin-api/users/?search=   ← جستجو روی نام، ایمیل و موبایل (موبایل هر شکلی که
//     ورود می‌پذیرد، نرمال‌شده). موجودی با Subquery در همان کوئری.
// GET /admin-api/users/<id>/      ← کاربر + ۲۰ تراکنش آخر + خریدها، بارگذاری‌ها و درخواست‌ها
// ═════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════
// کامپوننت صفحه
// ═════════════════════════════════════════════════════════════
export default function AdminUsersPage() {
  const [selectedId, setSelectedId] = useUrlParam("user", null);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(toLatinDigits(searchInput));
  const [users, setUsers] = useState([]);
  const [listState, setListState] = useState("loading");
  const [user, setUser] = useState(null);
  const [detailState, setDetailState] = useState("idle");

  useEffect(() => {
    let cancelled = false;
    setListState("loading");
    getAdminUsers({ search })
      .then((r) => !cancelled && (setUsers(r.results), setListState("ready")))
      .catch(() => !cancelled && setListState("error"));
    return () => {
      cancelled = true;
    };
  }, [search]);

  useEffect(() => {
    if (!selectedId) {
      setDetailState("idle");
      return;
    }
    let cancelled = false;
    setDetailState("loading");
    getAdminUser(selectedId)
      .then((u) => !cancelled && (setUser(u), setDetailState("ready")))
      .catch((err) => !cancelled && setDetailState(err.response?.status === 404 ? "notfound" : "error"));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const queuePane = (
    <>
      <div className="shrink-0 space-y-3 border-b border-gray-100 p-4">
        <h1 className="text-lg font-bold text-gray-900">کاربران</h1>
        <SearchBox id="user-search" value={searchInput} onChange={setSearchInput} placeholder="نام، ایمیل یا موبایل" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {listState === "loading" && <QueueSkeleton />}
        {listState === "error" && <p className="p-6 text-center text-sm text-red-600">لیست دریافت نشد.</p>}
        {listState === "ready" && users.length === 0 && <p className="p-6 text-center text-sm text-gray-500">کاربری پیدا نشد.</p>}
        <ul className="divide-y divide-gray-100">
          {users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => setSelectedId(u.id)}
                aria-current={u.id === selectedId ? "true" : undefined}
                className={`flex w-full items-center gap-3 p-3 text-right ${u.id === selectedId ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600" aria-hidden="true">
                  {u.first_name.charAt(0)} {u.last_name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-900">
                    {u.first_name} {u.last_name}
                    {u.is_staff && <Badge tone="blue">ادمین</Badge>}
                  </p>
                  <p dir="ltr" className="truncate text-right text-xs text-gray-500">{u.email || u.phone}</p>
                </div>
                <span className="shrink-0 text-xs text-gray-500">{toFaNumber(u.balance)} ت</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  let detailPane;
  if (detailState === "idle") detailPane = <EmptyDetail text="کاربری را از لیست انتخاب کنید." />;
  else if (detailState === "loading") detailPane = <div className="m-6 h-64 animate-pulse rounded-2xl bg-gray-200" aria-busy="true" />;
  else if (detailState !== "ready") detailPane = <EmptyDetail text={detailState === "notfound" ? "کاربر پیدا نشد." : "بارگذاری ناموفق بود."} />;
  else
    detailPane = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-6">
          <button type="button" onClick={() => setSelectedId(null)} className="text-sm font-medium text-gray-600 lg:hidden">→ لیست کاربران</button>

          {/* ── مشخصات ── */}
          <section className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto]">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
                {user.first_name} {user.last_name}
                {user.is_staff && <Badge tone="blue">ادمین</Badge>}
                {!user.is_active && <Badge tone="red">غیرفعال</Badge>}
              </h2>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-gray-500">ایمیل</dt>
                <dd dir="ltr" className="text-right text-gray-900">{user.email || "—"}</dd>
                <dt className="text-gray-500">موبایل</dt>
                <dd dir="ltr" className="text-right text-gray-900">{user.phone || "—"}</dd>
                <dt className="text-gray-500">عضویت</dt>
                <dd className="text-gray-900">{formatDate(user.date_joined)}</dd>
              </dl>
            </div>
            <div className="rounded-xl bg-blue-50 p-4 text-center sm:min-w-[11rem]">
              <p className="text-xs text-blue-800">موجودی کیف پول</p>
              <p className="mt-1 text-2xl font-bold text-blue-700">{toFaNumber(user.balance)}</p>
              <p className="text-xs text-blue-800">تومان</p>
              {/* اصلاح موجودی فقط از بخش کیف پول، با توضیح اجباری */}
              <Link to="/admin/wallet?tab=adjust" className="mt-2 inline-block text-xs font-semibold text-blue-700 hover:underline">اصلاح دستی ←</Link>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── تراکنش‌ها ── */}
            <Panel title="تراکنش‌های اخیر" className="lg:col-span-2" empty={!user.ledger.length && "تراکنشی ندارد."}>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-right font-medium">نوع</th>
                    <th className="px-4 py-2 text-right font-medium">شرح</th>
                    <th className="px-4 py-2 text-right font-medium">زمان</th>
                    <th className="px-4 py-2 text-left font-medium">مبلغ (تومان)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* جدیدترین اول، از سرور */}
                  {user.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-700">{LEDGER_LABEL[l.type] ?? l.type}</td>
                      <td className="px-4 py-2 text-gray-600">{l.description}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">{formatDateTime(l.created_at)}</td>
                      <td dir="ltr" className={`whitespace-nowrap px-4 py-2 text-left font-semibold ${l.amount > 0 ? "text-green-600" : "text-gray-900"}`}>
                        {l.amount > 0 ? "+" : "−"}{toFaNumber(Math.abs(l.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title={`خریدها (${toFaNumber(user.purchases.length)})`} empty={!user.purchases.length && "کتابی نخریده."}>
              <ul className="divide-y divide-gray-100">
                {user.purchases.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 px-4 py-2 text-sm">
                    <Link to={`/books/${p.id}`} className="truncate text-gray-900 hover:text-blue-700">{p.title}</Link>
                    <span className="shrink-0 text-xs text-gray-500">{formatDate(p.purchased_at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title={`بارگذاری‌ها (${toFaNumber(user.uploads.length)})`} empty={!user.uploads.length && "کتابی بارگذاری نکرده."}>
              <ul className="divide-y divide-gray-100">
                {user.uploads.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <Link to={`/admin/books?status=all&book=${b.id}`} className="truncate text-gray-900 hover:text-blue-700">{b.title}</Link>
                    <Badge tone={BOOK_STATUS[b.status][1]}>{BOOK_STATUS[b.status][0]}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title={`درخواست‌ها (${toFaNumber(user.requests.length)})`} empty={!user.requests.length && "درخواستی نداده."} className="lg:col-span-2">
              <ul className="divide-y divide-gray-100">
                {user.requests.map((r) => (
                  <li key={r.entry_id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <Link to={`/admin/requests?filter=all&request=${r.request_id}&entry=${r.entry_id}`} dir="auto" className="truncate text-gray-900 hover:text-blue-700">{r.title}</Link>
                    <Badge tone={REQUEST_STATUS[r.status][1]}>{REQUEST_STATUS[r.status][0]}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    );

  return (
    <AdminShell active="users">
      <QueueLayout hasSelection={Boolean(selectedId)} queue={queuePane} detail={detailPane} />
    </AdminShell>
  );
}

function Panel({ title, children, empty, className = "" }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-900">{title}</h3>
      {empty ? <p className="px-4 py-4 text-sm text-gray-400">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}
