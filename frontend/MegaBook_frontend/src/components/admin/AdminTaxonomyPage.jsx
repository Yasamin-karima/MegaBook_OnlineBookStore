import { useEffect, useState } from "react";
import {
  createCategory, createTag, deleteCategory, deleteTag, getAdminCategories, getAdminTags, renameCategory, renameTag,
} from "../../api/admin";
import AdminShell from "./AdminShell";
import { ConfirmDialog, SearchBox, Toast, errorMessage, toFaNumber, useToast } from "./adminUtils";

// ═════════════════════════════════════════════════════════════
// داشبورد ادمین — بخش «دسته‌ها و برچسب‌ها»
//
// دسته‌بندی‌ها همان تب‌های صفحهٔ اصلی فروشگاه‌اند و فقط ادمین آن‌ها را می‌سازد (از اینجا،
// یا با «+ دستهٔ تازه» در بررسی کتاب). برچسب‌ها را کاربران هم هنگام بارگذاری آزادانه
// می‌سازند؛ کار اصلی این صفحه پاک کردن برچسب‌های اشتباه یا تکراری است.
//
// کنار هر مورد تعداد کتاب‌هایش است (در سرور با Count حساب می‌شود). حذف دسته کتاب‌هایش را
// بی‌دسته می‌کند؛ حذف برچسب فقط آن را از کتاب‌ها برمی‌دارد. هیچ کتابی پاک نمی‌شود.
//
// GET/POST /admin-api/categories/ و /admin-api/tags/   ← [{ id, name, book_count }]
// PATCH/DELETE /admin-api/<categories|tags>/<id>/
// ═════════════════════════════════════════════════════════════

const KINDS = {
  categories: {
    title: "دسته‌بندی‌ها",
    hint: "تب‌های صفحهٔ اصلی فروشگاه. کتاب دستهٔ حذف‌شده بی‌دسته می‌شود.",
    load: getAdminCategories, create: createCategory, rename: renameCategory, remove: deleteCategory,
    maxLength: 100,
    deleteText: (item) => `${toFaNumber(item.book_count)} کتاب این دسته بی‌دسته می‌شوند و فقط در تب «همه» دیده می‌شوند.`,
  },
  tags: {
    title: "برچسب‌ها",
    hint: "کاربران هنگام بارگذاری برچسب تازه می‌سازند؛ برچسب‌های اشتباه یا تکراری را اینجا پاک کنید.",
    load: getAdminTags, create: createTag, rename: renameTag, remove: deleteTag,
    maxLength: 50,
    deleteText: (item) => `این برچسب از ${toFaNumber(item.book_count)} کتاب برداشته می‌شود. خود کتاب‌ها دست نمی‌خورند.`,
  },
};

export default function AdminTaxonomyPage() {
  const [toast, showToast] = useToast();
  return (
    <AdminShell active="taxonomy">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 p-4 lg:grid-cols-2 lg:p-6">
          <h1 className="text-lg font-bold text-gray-900 lg:col-span-2">دسته‌ها و برچسب‌ها</h1>
          <TaxonomyPanel kind="categories" showToast={showToast} />
          <TaxonomyPanel kind="tags" showToast={showToast} />
        </div>
      </div>
      <Toast toast={toast} />
    </AdminShell>
  );
}

function TaxonomyPanel({ kind, showToast }) {
  const config = KINDS[kind];
  const [items, setItems] = useState([]);
  const [state, setState] = useState("loading");
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name }
  const [deleting, setDeleting] = useState(null); // item

  useEffect(() => {
    let cancelled = false;
    config
      .load()
      .then((rows) => !cancelled && (setItems(rows), setState("ready")))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [config]);

  const sorted = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  const q = filter.trim();
  const shown = q ? items.filter((i) => i.name.includes(q)) : items;

  async function add(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await config.create(newName.trim());
      setItems((list) => sorted([...list, created]));
      setNewName("");
      setError("");
      showToast(`«${created.name}» ساخته شد.`);
    } catch (err) {
      setError(errorMessage(err, "ساخته نشد."));
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(e) {
    e.preventDefault();
    const item = items.find((i) => i.id === editing.id);
    if (!editing.name.trim() || editing.name.trim() === item.name) return setEditing(null);
    setBusy(true);
    try {
      const updated = await config.rename(editing.id, editing.name.trim());
      setItems((list) => sorted(list.map((i) => (i.id === updated.id ? updated : i))));
      setEditing(null);
      showToast("نام عوض شد.");
    } catch (err) {
      showToast(errorMessage(err, "تغییر نام انجام نشد."), "red");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await config.remove(deleting.id);
      setItems((list) => list.filter((i) => i.id !== deleting.id));
      showToast(`«${deleting.name}» حذف شد.`);
      setDeleting(null);
    } catch (err) {
      showToast(errorMessage(err, "حذف نشد."), "red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-gray-100 p-4">
        <div>
          <h2 className="font-bold text-gray-900">
            {config.title} {state === "ready" && <span className="text-sm font-normal text-gray-500">({toFaNumber(items.length)})</span>}
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">{config.hint}</p>
        </div>
        <form onSubmit={add} className="flex gap-2">
          <label htmlFor={`new-${kind}`} className="sr-only">نام تازه</label>
          <input
            id={`new-${kind}`}
            value={newName}
            maxLength={config.maxLength}
            onChange={(e) => {
              setNewName(e.target.value);
              setError("");
            }}
            placeholder="نام تازه…"
            aria-invalid={Boolean(error)}
            className={`h-10 flex-1 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${error ? "border-red-400" : "border-gray-300 focus:border-blue-600"}`}
          />
          <button type="submit" disabled={busy || !newName.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            افزودن
          </button>
        </form>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {items.length > 8 && <SearchBox id={`filter-${kind}`} value={filter} onChange={setFilter} placeholder="جستجو در فهرست" />}
      </div>

      <div className="max-h-[32rem] min-h-0 overflow-y-auto">
        {state === "loading" && <p className="p-6 text-center text-sm text-gray-400">در حال بارگذاری…</p>}
        {state === "error" && <p className="p-6 text-center text-sm text-red-600">فهرست دریافت نشد.</p>}
        {state === "ready" && shown.length === 0 && <p className="p-6 text-center text-sm text-gray-400">موردی نیست.</p>}
        <ul className="divide-y divide-gray-100">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-4 py-2">
              {editing?.id === item.id ? (
                <form onSubmit={saveRename} className="flex flex-1 items-center gap-2">
                  <label htmlFor={`rename-${kind}-${item.id}`} className="sr-only">نام تازه</label>
                  <input
                    id={`rename-${kind}-${item.id}`}
                    autoFocus
                    value={editing.name}
                    maxLength={config.maxLength}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    className="h-8 flex-1 rounded-lg border border-gray-300 px-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                  <button type="submit" disabled={busy} className="text-xs font-semibold text-blue-700">ذخیره</button>
                  <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500">انصراف</button>
                </form>
              ) : (
                <>
                  <span className="flex-1 truncate text-sm text-gray-900">{item.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">{toFaNumber(item.book_count)} کتاب</span>
                  <button type="button" onClick={() => setEditing({ id: item.id, name: item.name })} className="shrink-0 rounded px-1.5 text-xs text-gray-600 hover:bg-gray-100">
                    تغییر نام
                  </button>
                  <button type="button" onClick={() => setDeleting(item)} className="shrink-0 rounded px-1.5 text-xs text-red-600 hover:bg-red-50">
                    حذف
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`حذف «${deleting?.name ?? ""}»`}
        tone="red"
        confirmLabel="حذف"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        {deleting && <p>{deleting.book_count ? config.deleteText(deleting) : "هیچ کتابی از آن استفاده نمی‌کند."}</p>}
      </ConfirmDialog>
    </section>
  );
}
