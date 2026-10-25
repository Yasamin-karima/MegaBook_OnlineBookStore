import apiClient from './client';

// The admin dashboard's API (/admin-api/). Staff only: the backend answers 404 to
// everyone else, so hiding the menu in the frontend is only cosmetic.
// Lists are paginated: { count, next, previous, results, ...extra counts }.
// Errors (400) come as { field: ["Persian message"] }; 409 { detail } means the item
// changed meanwhile (e.g. another admin decided it a moment ago).

const get = (url, params) => apiClient.get(`/admin-api/${url}`, { params }).then((r) => r.data);
const post = (url, data) => apiClient.post(`/admin-api/${url}`, data).then((r) => r.data);
const patch = (url, data) => apiClient.patch(`/admin-api/${url}`, data).then((r) => r.data);
const del = (url) => apiClient.delete(`/admin-api/${url}`).then((r) => r.data);

// --- Home and the side menu ---
// => { books, requests, conversations, wallet, reviews }
export const getCounts = () => get('counts/');
// => { today_label, month_label, queues: { key: { count, oldest_at } }, finance }
export const getSummary = () => get('summary/');

// --- Books ---
export const getBookQueue = ({ status, search, page = 1 }) => get('books/', { status, search, page });
export const getAdminBook = (id) => get(`books/${id}/`);
// Send only what changed: { status, price, seller_share, description, category_id, tags (names), rejection_reason }
export const saveAdminBook = (id, fields) => patch(`books/${id}/`, fields);

// --- Categories and tags: [{ id, name, book_count }] ---
export const getAdminCategories = () => get('categories/');
export const createCategory = (name) => post('categories/', { name });
export const renameCategory = (id, name) => patch(`categories/${id}/`, { name });
export const deleteCategory = (id) => del(`categories/${id}/`);
export const getAdminTags = () => get('tags/');
export const createTag = (name) => post('tags/', { name });
export const renameTag = (id, name) => patch(`tags/${id}/`, { name });
export const deleteTag = (id) => del(`tags/${id}/`);

// --- Book requests ---
export const getRequestQueue = ({ filter, search, page = 1 }) => get('book-requests/', { filter, search, page });
export const getAdminRequest = (id) => get(`book-requests/${id}/`);
export const saveAdminRequest = (id, { status, rejection_reason }) => patch(`book-requests/${id}/`, { status, rejection_reason });
export const markRequestReviewed = (id) => post(`book-requests/${id}/mark-reviewed/`);

// --- Conversations ---
// One conversation per parent: an upload ("upload", a book id) or a requester's
// entry ("entry", a RequestEntry id). The object fits AdminConversationPanel's `api` prop.
export function conversationApi(kind, parentId) {
  const base = `${kind === 'upload' ? 'books' : 'request-entries'}/${parentId}/conversation/`;
  return {
    // => { conversation: { state, closed_kind, closed_at, closed_by, close_reason }, messages, history }
    load: (after) => get(base, after ? { after } : {}),
    send: (text) => post(`${base}messages/`, { text }),
    markRead: () => post(`${base}read/`),
    setState: (action, reason) => post(`${base}${action}/`, action === 'close' ? { reason } : {}),
  };
}
export const getInbox = ({ filter, kind, search, page = 1 }) => get('conversations/', { filter, kind, search, page });
export const getInboxItem = (id) => get(`conversations/${id}/`);

// --- Wallet ---
export const getTopups = ({ status, search, page = 1 }) => get('wallet/topups/', { status, search, page });
export const approveTopup = (id) => post(`wallet/topups/${id}/approve/`);
export const rejectTopup = (id, reason) => post(`wallet/topups/${id}/reject/`, { reason });
export const getWithdrawals = ({ status, search, page = 1 }) => get('wallet/withdrawals/', { status, search, page });
export const completeWithdrawal = (id) => post(`wallet/withdrawals/${id}/complete/`);
export const rejectWithdrawal = (id, reason) => post(`wallet/withdrawals/${id}/reject/`, { reason });
export const getAdjustments = (page = 1) => get('wallet/adjustments/', { page });
// amount is signed. => { adjustment, balance }
export const createAdjustment = ({ user_id, amount, description }) => post('wallet/adjustments/', { user_id, amount, description });

// --- Reviews ---
export const getAdminReviews = ({ filter, search, page = 1 }) => get('reviews/', { filter, search, page });
export const checkReview = (id) => post(`reviews/${id}/check/`);
export const hideReview = (id, reason) => post(`reviews/${id}/hide/`, { reason });
export const unhideReview = (id) => post(`reviews/${id}/unhide/`);

// --- Users (read-only) ---
export const getAdminUsers = ({ search, page = 1 }) => get('users/', { search, page });
export const getAdminUser = (id) => get(`users/${id}/`);
