import { useEffect, useState } from "react";
import { createReview, deleteMyReview, getReviews, updateMyReview } from "../api/reviews";
import { formatDate, toFaNumber } from "../utils/format";

// ═════════════════════════════════════════════════════════════
// بخش «نظرات خوانندگان» صفحه‌ی کتاب (فقط BookDetailPage از آن استفاده می‌کند).
// داده از GET /catalog/books/<id>/reviews/ می‌آید (src/api/reviews.js):
//   • results فقط نظرهای نمایش‌داده‌شده‌اند، آخرین ارسال اول، ۱۰ تا در هر صفحه.
//   • my_review نظر خود کاربر است در هر حالتی (حتی پنهان‌شده توسط مدیر)؛ در results نیست
//     و این‌جا بالای فهرست سنجاق می‌شود.
// canReview / hasReview از خود کتاب می‌آیند (BookDetailSerializer): دکمه‌ی «نظر بدهید»
// فقط برای خریداری است که هنوز نظری ندارد. به مهمان و غیرخریدار هیچ توضیحی نشان داده نمی‌شود.
// بعد از ثبت، ویرایش یا حذف، onChanged کتاب را دوباره می‌گیرد تا خلاصه‌ی امتیاز و پرچم‌ها
// بدون بارگذاری دوباره‌ی صفحه به‌روز شوند.
// ═════════════════════════════════════════════════════════════

// Same limit as the backend (reviews.models.MAX_BODY_LENGTH)
const MAX_BODY_LENGTH = 2000;
// How many reviews the section shows before «مشاهدهٔ همه»
const PREVIEW_COUNT = 3;
// A review body longer than this is clamped, with «ادامه»
const LONG_BODY = 220;

const SUBMIT_FAILED = "ارسال نظر ناموفق بود. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.";

export default function BookReviews({ bookId, canReview, hasReview, onChanged, showToast }) {
  // با هر تغییر (ثبت، ویرایش، حذف، «تلاش دوباره») یکی زیاد می‌شود تا صفحه‌ی اول دوباره گرفته شود.
  // داده‌ی قبلی تا رسیدن جواب تازه روی صفحه می‌ماند؛ «در حال بارگذاری» فقط بار اول دیده می‌شود.
  const [version, setVersion] = useState(0);
  const requestKey = `${bookId}:${version}`;
  // { key, status: ready | error, results, count, next, page, mine }
  const [result, setResult] = useState({ key: null, status: "loading", results: [], count: 0, next: null, page: 1, mine: null });
  const loaded = result.status === "ready";

  const [expanded, setExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // null: no form; "new": writing a review; "edit": editing mine
  const [formMode, setFormMode] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const key = requestKey;
    getReviews(bookId, 1, { signal: controller.signal })
      .then((data) =>
        setResult({
          key, status: "ready", results: data.results, count: data.count, next: data.next, page: 1, mine: data.my_review,
        })
      )
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult((prev) => ({ ...prev, key, status: prev.status === "ready" ? "ready" : "error" }));
      });
    return () => controller.abort();
  }, [bookId, requestKey]);

  const reload = () => setVersion((v) => v + 1);

  async function handleLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getReviews(bookId, result.page + 1);
      setResult((prev) => ({
        ...prev, results: [...prev.results, ...data.results], count: data.count, next: data.next, page: prev.page + 1,
      }));
    } catch {
      showToast("بارگذاری نظرهای بیشتر ناموفق بود.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Throws the backend's errors to the form, which shows them
  async function handleSubmit(values) {
    const wasHidden = Boolean(result.mine?.is_hidden);
    const saved = formMode === "edit" ? await updateMyReview(bookId, values) : await createReview(bookId, values);
    setResult((prev) => ({ ...prev, mine: saved }));
    setFormMode(null);
    if (formMode === "new") showToast("نظر شما ثبت شد.");
    else showToast(wasHidden ? "نظر شما ویرایش شد و دوباره نمایش داده می‌شود." : "نظر شما ویرایش شد.");
    reload();
    onChanged();
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteMyReview(bookId);
      setResult((prev) => ({ ...prev, mine: null }));
      setConfirmDelete(false);
      showToast("نظر شما حذف شد.");
      reload();
      onChanged();
    } catch {
      showToast("حذف نظر ناموفق بود. دوباره تلاش کنید.");
    } finally {
      setDeleting(false);
    }
  }

  const mine = result.mine;
  const shown = expanded ? result.results : result.results.slice(0, PREVIEW_COUNT);
  const showWriteButton = loaded && canReview && !hasReview && !mine && formMode === null;

  return (
    // scroll-mt: the sticky header (h-14), and below md the app's top bar (h-16) above it,
    // must not cover the heading when the summary scrolls here
    <section id="reviews" className="mx-4 mt-6 scroll-mt-36 md:mx-0 md:scroll-mt-20">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-gray-900">نظرات خوانندگان</h3>
        {showWriteButton && (
          <button
            type="button"
            onClick={() => setFormMode("new")}
            className="flex h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
          >
            <span aria-hidden="true">✍️</span>
            نظر بدهید
          </button>
        )}
      </div>

      {result.status === "loading" && <ReviewsSkeleton />}

      {result.status === "error" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-500">بارگذاری نظرها ناموفق بود.</p>
          <button type="button" onClick={reload} className="mt-2 text-sm font-semibold text-blue-600 hover:underline">
            تلاش دوباره
          </button>
        </div>
      )}

      {loaded && (
        <div className="space-y-3">
          {formMode === "new" && (
            <ReviewForm onSubmit={handleSubmit} onCancel={() => setFormMode(null)} submitLabel="ثبت نظر" />
          )}

          {mine && formMode === "edit" && (
            <ReviewForm
              initial={mine}
              onSubmit={handleSubmit}
              onCancel={() => setFormMode(null)}
              submitLabel={mine.is_hidden ? "ثبت و نمایش دوباره" : "ذخیره تغییرات"}
            />
          )}

          {mine && formMode !== "edit" && (
            <MyReviewCard
              review={mine}
              onEdit={() => {
                setConfirmDelete(false);
                setFormMode("edit");
              }}
              confirmDelete={confirmDelete}
              onAskDelete={() => setConfirmDelete(true)}
              onCancelDelete={() => setConfirmDelete(false)}
              onDelete={handleDelete}
              deleting={deleting}
            />
          )}

          {shown.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-4 shadow-sm">
              {shown.map((review) => (
                <li key={review.id} className="py-4">
                  <ReviewItem review={review} />
                </li>
              ))}
            </ul>
          )}

          {!mine && result.results.length === 0 && formMode === null && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl" aria-hidden="true">💬</div>
              <p className="text-sm text-gray-500">هنوز نظری برای این کتاب ثبت نشده است.</p>
            </div>
          )}

          {/* «مشاهدهٔ همه» opens the full list right here; more pages with «بیشتر» */}
          {!expanded && result.count > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-blue-200 bg-white text-sm font-semibold text-blue-600 hover:bg-blue-50"
            >
              مشاهدهٔ همه ({toFaNumber(result.count)} نظر)
            </button>
          )}
          {expanded && result.next && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-blue-200 bg-white text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? "در حال بارگذاری…" : "بیشتر"}
            </button>
          )}
          {expanded && result.count > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mx-auto block text-sm font-semibold text-gray-500 hover:underline"
            >
              نمایش کمتر
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// اجزای بخش نظرها
// ─────────────────────────────────────────────────────────────

// Five stars for display; the label is for screen readers
export function Stars({ rating, className = "text-sm" }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`} role="img" aria-label={`امتیاز ${toFaNumber(rating)} از ۵`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" className={n <= rating ? "text-amber-400" : "text-gray-300"}>
          ★
        </span>
      ))}
    </span>
  );
}

// Name, date and «ویرایش‌شده» on one line
function ReviewMeta({ review }) {
  return (
    <p className="text-xs text-gray-500">
      <span className="font-semibold text-gray-800">{review.author_name}</span>
      <span aria-hidden="true"> · </span>
      {formatDate(review.created_at)}
      {review.is_edited && (
        <>
          <span aria-hidden="true"> · </span>
          ویرایش‌شده
        </>
      )}
    </p>
  );
}

// The text, clamped when long. Plain text only (never rendered as HTML).
function ReviewBody({ body }) {
  const [open, setOpen] = useState(false);
  if (!body) return null;
  const long = body.length > LONG_BODY;
  return (
    <>
      <p dir="auto" className={`mt-2 whitespace-pre-line text-sm leading-7 text-gray-700 ${long && !open ? "line-clamp-4" : ""}`}>
        {body}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-sm font-semibold text-blue-600 hover:underline"
        >
          {open ? "نمایش کمتر" : "ادامه"}
        </button>
      )}
    </>
  );
}

function ReviewItem({ review }) {
  return (
    <article>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReviewMeta review={review} />
        <Stars rating={review.rating} />
      </div>
      <ReviewBody body={review.body} />
    </article>
  );
}

function MyReviewCard({ review, onEdit, confirmDelete, onAskDelete, onCancelDelete, onDelete, deleting }) {
  return (
    <article className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">نظر شما</span>
        <Stars rating={review.rating} />
      </div>

      {review.is_hidden && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="note">
          <p className="font-semibold">
            <span aria-hidden="true">🙈 </span>
            این نظر توسط مدیر پنهان شده است
          </p>
          {review.hide_reason && (
            <p dir="auto" className="mt-1 whitespace-pre-line">
              دلیل: {review.hide_reason}
            </p>
          )}
          <p className="mt-1 text-xs text-amber-800">
            دیگران فعلاً این نظر را نمی‌بینند. اگر آن را ویرایش و دوباره ثبت کنید، دوباره نمایش داده می‌شود.
          </p>
        </div>
      )}

      <div className="mt-2">
        <ReviewMeta review={review} />
        <ReviewBody body={review.body} />
      </div>

      {confirmDelete ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2">
          <p className="text-sm font-medium text-red-700">نظرتان حذف شود؟</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={deleting}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-gray-600 hover:bg-white"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              autoFocus
              className="flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-70"
            >
              {deleting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              حذف
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="h-9 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-600 hover:bg-blue-50"
          >
            ویرایش
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            className="h-9 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            حذف
          </button>
        </div>
      )}
    </article>
  );
}

// The write / edit form. initial: my review when editing.
// onSubmit({ rating, body }) throws the axios error; its Persian messages are shown here.
function ReviewForm({ initial = null, onSubmit, onCancel, submitLabel }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [body, setBody] = useState(initial?.body ?? "");
  const [sending, setSending] = useState(false);
  // { rating, body, detail }: one message each
  const [errors, setErrors] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return; // no double submit
    if (!rating) {
      setErrors({ rating: "امتیاز را انتخاب کنید." });
      return;
    }
    setErrors({});
    setSending(true);
    try {
      await onSubmit({ rating, body });
    } catch (err) {
      const data = err.response?.data;
      if (data && typeof data === "object") {
        const first = (value) => (Array.isArray(value) ? value[0] : value);
        setErrors({ rating: first(data.rating), body: first(data.body), detail: data.detail ?? null });
      } else {
        setErrors({ detail: SUBMIT_FAILED });
      }
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <fieldset>
        <legend className="text-sm font-semibold text-gray-900">امتیاز شما</legend>
        <StarInput value={rating} onChange={setRating} invalid={Boolean(errors.rating)} />
        {errors.rating && <p className="mt-1 text-xs text-red-600" role="alert">{errors.rating}</p>}
      </fieldset>

      <label htmlFor="review-body" className="mt-4 block text-sm font-semibold text-gray-900">
        نظر شما <span className="font-normal text-gray-400">(اختیاری)</span>
      </label>
      <textarea
        id="review-body"
        dir="auto"
        rows={4}
        maxLength={MAX_BODY_LENGTH}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="دربارهٔ این کتاب چه فکر می‌کنید؟"
        aria-invalid={Boolean(errors.body)}
        aria-describedby="review-body-count"
        className={`mt-1 w-full resize-y rounded-xl border px-3 py-2 text-sm leading-7 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
          errors.body ? "border-red-400" : "border-gray-300 focus:border-blue-500"
        }`}
      />
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="text-xs text-red-600" role={errors.body ? "alert" : undefined}>{errors.body}</p>
        <p id="review-body-count" className="shrink-0 text-xs text-gray-400">
          {toFaNumber(body.length)} / {toFaNumber(MAX_BODY_LENGTH)}
        </p>
      </div>

      {errors.detail && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errors.detail}</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={sending}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:bg-blue-300"
        >
          {sending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {sending ? "در حال ارسال…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="h-11 rounded-xl px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100"
        >
          انصراف
        </button>
      </div>
    </form>
  );
}

// Five stars as a radio group: real radio inputs (visually hidden), so the keyboard
// works as everywhere else (Tab to the group, arrow keys to change the value)
function StarInput({ value, onChange, invalid }) {
  return (
    <div className="mt-2 flex gap-1" role="radiogroup" aria-label="امتیاز از ۱ تا ۵" aria-invalid={invalid}>
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          className="cursor-pointer rounded-lg p-1 text-3xl leading-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600/40"
        >
          <input
            type="radio"
            name="review-rating"
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="sr-only"
            aria-label={`${toFaNumber(n)} ستاره`}
          />
          <span aria-hidden="true" className={n <= value ? "text-amber-400" : "text-gray-300 hover:text-amber-200"}>
            ★
          </span>
        </label>
      ))}
    </div>
  );
}

// Grey placeholders while the first page loads
function ReviewsSkeleton() {
  return (
    <div className="animate-pulse space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" aria-busy="true" aria-label="در حال بارگذاری نظرها">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="h-3 w-32 rounded bg-gray-200" />
          <div className="mt-3 h-3 w-full rounded bg-gray-100" />
          <div className="mt-2 h-3 w-2/3 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
