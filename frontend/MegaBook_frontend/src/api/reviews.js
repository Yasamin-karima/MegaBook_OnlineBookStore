import apiClient from './client';

// A book's reviews (the reviews app). One review per buyer per book; the book page is
// the only place to write, edit or delete it.
//
// A review: { id, rating (1-5), body ("" when only a rating), author_name («سارا ج.»),
//             created_at, is_edited }
// The user's own review also has { is_hidden, hide_reason }: an admin hid it, and why.

// Visible reviews, last submitted first, 10 per page (public; works for guests too).
// => { count, next, previous, results: [review], my_review: own review | null }
// my_review is the logged-in user's own review whatever its state; it is never in results.
export async function getReviews(bookId, page = 1, { signal } = {}) {
  const response = await apiClient.get(`/catalog/books/${bookId}/reviews/`, { params: { page }, signal });
  return response.data;
}

// { rating, body } => my review (201). Errors (err.response.data):
//   400 { rating: ["..."], body: ["..."] }
//   403 { code: not_buyer | own_upload | book_not_approved, detail }
//   409 { code: already_reviewed, detail }
export async function createReview(bookId, data) {
  const response = await apiClient.post(`/catalog/books/${bookId}/reviews/`, data);
  return response.data;
}

// { rating?, body? } => my review. Submitting publishes it again if an admin had hidden it.
export async function updateMyReview(bookId, data) {
  const response = await apiClient.patch(`/catalog/books/${bookId}/reviews/mine/`, data);
  return response.data;
}

export async function deleteMyReview(bookId) {
  await apiClient.delete(`/catalog/books/${bookId}/reviews/mine/`);
}
