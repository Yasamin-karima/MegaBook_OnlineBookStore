import apiClient from './client';

// In-site notifications (logged-in users only). Only the last 90 days are ever returned.
//
// A notification: { id, type, icon (emoji), text (Persian, built by the backend),
//                   link, created_at, read_at (null = unread) }
// link: { kind: "app", path: "/books/12" }  a page of this site
//       { kind: "admin", url: "http://…" }  a Django admin page (staff notifications)
//       null                               its source was deleted: not clickable

// Newest first, 20 per page => { count, next, previous, results }
// Fetching the list marks nothing as read.
export async function getNotifications(page = 1) {
  const response = await apiClient.get('/notifications/', { params: { page } });
  return response.data;
}

// => number of unread notifications (polled by the bell)
export async function getUnreadCount() {
  const response = await apiClient.get('/notifications/unread-count/');
  return response.data.count;
}

// Someone else's (or an expired) notification => 404
export async function markNotificationRead(id) {
  await apiClient.post(`/notifications/${id}/read/`);
}

export async function markAllNotificationsRead() {
  await apiClient.post('/notifications/read-all/');
}
