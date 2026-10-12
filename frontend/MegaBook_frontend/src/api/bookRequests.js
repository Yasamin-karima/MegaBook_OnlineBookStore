import apiClient from './client';

// ثبت درخواست کتاب بر اساس شابک (فقط کاربر واردشده).
// payload: { isbn, title, authors?, cover_url?, notes? }   (authors متن ساده است، مثلاً «الف، ب»)
//
// 201 => { result: "requested", message, isbn }
// خطاها (در err.response):
//   409 => { result: "already_requested", message, isbn }
//   409 => { result: "rejected", message, isbn, rejection_reason }
//   409 => { result: "available", message, isbn, book_id }
//   400 => { field: ["پیام"] }   ورودی نامعتبر
export async function createBookRequest(payload) {
  const response = await apiClient.post('/book-requests/', payload);
  return response.data;
}
