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

// The public list of OPEN requests (no login needed). Nothing about who asked.
// params: { ordering: "newest" | "most_requested", search?, page? }
// => { count, next, previous, results: [{ id, isbn, title, authors, cover, created_at,
//      requester_count, is_mine, book_in_review }] }   is_mine is always false for a guest
export async function getPublicRequests({ ordering = 'newest', search = '', page = 1 } = {}) {
  const params = { ordering, page };
  if (search) params.search = search;
  const response = await apiClient.get('/book-requests/', { params });
  return response.data;
}

// "I want this too" (login). Safe to repeat: the second call creates nothing.
// 201 added / 200 already requested => { result, message, request: <updated list item> }
// 409 => { result: "not_open" | "in_review" | "available", message }
export async function joinRequest(id) {
  const response = await apiClient.post(`/book-requests/${id}/join/`);
  return response.data;
}
