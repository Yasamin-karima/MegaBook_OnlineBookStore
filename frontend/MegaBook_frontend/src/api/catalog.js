import apiClient from './client';

// => [{ id, name }, ...] برای منوی «موضوع» فرم کتاب و تب‌های صفحه‌ی اصلی
// signal (اختیاری) از یک AbortController می‌آید تا بشود درخواست را وسط کار لغو کرد.
export async function getCategories({ signal } = {}) {
  const response = await apiClient.get('/catalog/categories/', { signal });
  return response.data;
}

// فهرست کتاب‌های تاییدشده، جدیدترین اول، ۲۰ تا در هر صفحه.
// category: شناسه‌ی دسته‌بندی، یا null برای همه.
// => { count, next, previous, results: [{ id, title, authors, cover, price, category, language, created_at }] }
export async function getBooks({ category = null, signal } = {}) {
  // axios پارامترهای null/undefined را در آدرس نمی‌گذارد، پس «همه» یعنی بدون ?category
  const response = await apiClient.get('/catalog/books/', { params: { category }, signal });
  return response.data;
}

// یک کتاب تاییدشده با همه‌ی جزئیات (عمومی). کتاب ناموجود یا تاییدنشده => خطای 404.
// => { id, title, authors: [نام‌ها], cover, price, category: {id, name} | null, language, created_at,
//      original_title, isbn, translators: [نام‌ها], publisher: نام | null, tags: [نام‌ها],
//      description, page_count, publication_year, edition, sample_file, file_size }
export async function getBook(id, { signal } = {}) {
  const response = await apiClient.get(`/catalog/books/${id}/`, { signal });
  return response.data;
}

// اطلاعات کتاب از Open Library، از طریق بک‌اند (فقط کاربر واردشده).
// isbn همان ورودی خام کاربر است (خط تیره، رقم فارسی، ISBN-10)؛ بک‌اند خودش آن را درست می‌کند.
// 200 => { isbn, title, authors, publisher, page_count, publication_year, cover_url, subjects, already_exists }
// خطاها (در err.response):
//   400 => { isbn: ["پیام"] }                       شابک نامعتبر
//   404 => { detail, isbn, already_exists }         پیدا نشد
//   502 => { detail, isbn, already_exists }         Open Library در دسترس نیست
export async function lookupIsbn(isbn) {
  const response = await apiClient.get('/catalog/isbn-lookup/', { params: { isbn } });
  return response.data;
}

// formData همان خروجی buildFormData در AddBookWizard است.
// Content-Type را دستی نمی‌گذاریم: مرورگر خودش multipart/form-data را با boundary درست می‌سازد.
// => کتاب ساخته‌شده { id, title, status: "pending", ... }
export async function createBook(formData) {
  const response = await apiClient.post('/catalog/books/', formData);
  return response.data;
}

// The full book file is private (uploader and admins; buyers after checkout).
// => { url, expires_in }: a signed link valid for a few minutes, usable in a plain
// <a href> or window.open (the file view needs no login header). 404 if not allowed.
export async function getBookFileLink(id) {
  const response = await apiClient.get(`/catalog/books/${id}/file-link/`);
  return response.data;
}
