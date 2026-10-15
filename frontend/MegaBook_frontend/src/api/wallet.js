import apiClient from './client';

// All wallet endpoints need login; each user only ever sees their own wallet.
// Errors (400) come as { field: ["Persian message"] } or { non_field_errors: [...] }.

// => { balance, topup_card: { number, holder } | null }
// balance is computed by the backend from the ledger; the page never adds up entries itself.
export async function getWallet() {
  const response = await apiClient.get('/wallet/');
  return response.data;
}

// filter: "all" | "purchase" | "sale_income" | "topup" | "withdrawal"
// => { count, next, previous, results: [{ id, type, amount, title, source, created_at }] }
// amount is signed: positive = money in, negative = money out.
// source: "gateway" | "card_to_card" for top-ups, otherwise null.
export async function getTransactions({ filter = 'all', page = 1 } = {}) {
  const response = await apiClient.get('/wallet/transactions/', { params: { type: filter, page } });
  return response.data;
}

// Online top-up. For now a mock gateway that pays at once (development only:
// the backend answers 404 when DEBUG is off). => { status: "paid", balance }
// A real gateway will return { status: "redirect", payment_url } instead.
export async function startTopup(amount) {
  const response = await apiClient.post('/wallet/mock-topup/', { amount });
  return response.data;
}

// Card-to-card top-up: the user already paid to MegaBook's card and reports it here.
// formData: amount, tracking_number, deposited_at (ISO), receipt? (image file)
export async function createTopupRequest(formData) {
  const response = await apiClient.post('/wallet/topup-requests/', formData);
  return response.data;
}

// => { count, next, previous, results: [{ id, amount, tracking_number, deposited_at, has_receipt,
//      status, status_label, rejection_reason, created_at, reviewed_at }] }
export async function getTopupRequests() {
  const response = await apiClient.get('/wallet/topup-requests/');
  return response.data;
}

// The amount leaves the wallet at once; a rejected request gives it back.
// => { id, amount, card_number (masked), status, status_label, admin_note, created_at, reviewed_at }
export async function createWithdrawal({ amount, card_number }) {
  const response = await apiClient.post('/wallet/withdrawals/', { amount, card_number });
  return response.data;
}

export async function getWithdrawals() {
  const response = await apiClient.get('/wallet/withdrawals/');
  return response.data;
}

// A top-up request's receipt is private (owner and admins). Responses only say
// has_receipt; this gives a signed link valid for a few minutes. => { url, expires_in }
export async function getReceiptLink(topupRequestId) {
  const response = await apiClient.get(`/wallet/topup-requests/${topupRequestId}/receipt-link/`);
  return response.data;
}
