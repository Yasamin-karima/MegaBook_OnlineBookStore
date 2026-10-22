import apiClient from './client';

// Everything the dashboard cards show, in one response (every number computed by the server):
// {
//   user:     { first_name, last_name, email, phone },   // email or phone may be null
//   wallet:   { balance },                                // toman, from the wallet ledger
//   cart:     { count, total },
//   requests: { open, fulfilled, rejected },
//   uploads:  { pending, approved, rejected, sales, earnings }  // earnings: toman, from the ledger
// }
export async function getDashboard() {
  const response = await apiClient.get('/dashboard/');
  return response.data;
}

// "My Requests & Uploads" (read-only). params: { status?, search?, page? }
// Paginated: { count, next, previous, results }. Ownership is enforced by the server.
//
// requests results: [{ id (RequestEntry), isbn, title, authors, cover, status: "open" | "fulfilled" | "rejected",
//   requested_at, conversation_closed, unread_count, last_message: { sender, text } | null,
//   book_id (fulfilled only, else null) }]
export async function getMyRequests(params = {}) {
  const response = await apiClient.get('/dashboard/requests/', { params: clean(params) });
  return response.data;
}

// uploads results: [{ id (Book), isbn, title, authors, cover, status: "pending" | "approved" | "rejected",
//   uploaded_at, conversation_closed, unread_count, last_message, and for approved only
//   sales_count, earnings (toman, from the wallet ledger), book_id }]. Never a file or download address.
export async function getMyUploads(params = {}) {
  const response = await apiClient.get('/dashboard/uploads/', { params: clean(params) });
  return response.data;
}

// Drop empty filters so the URL stays clean
function clean(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value != null));
}
