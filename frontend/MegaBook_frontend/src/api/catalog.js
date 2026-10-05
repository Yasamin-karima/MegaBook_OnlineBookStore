import apiClient from './client';

// => [{ id, name }, ...] برای منوی «موضوع» فرم کتاب
export async function getCategories() {
  const response = await apiClient.get('/catalog/categories/');
  return response.data;
}

// formData همان خروجی buildFormData در AddBookWizard است.
// Content-Type را دستی نمی‌گذاریم: مرورگر خودش multipart/form-data را با boundary درست می‌سازد.
// => کتاب ساخته‌شده { id, title, status: "pending", ... }
export async function createBook(formData) {
  const response = await apiClient.post('/catalog/books/', formData);
  return response.data;
}
