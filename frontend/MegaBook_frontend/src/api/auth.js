import { notifyAuthChanged } from './authEvents';
import apiClient from './client';

// توکن‌ها رو ذخیره کن تا در درخواست‌های بعدی استفاده بشن
function saveTokens({ access, refresh }) {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
  notifyAuthChanged();
}

// User object returned by the backend:
//   { id, first_name, last_name, email, phone, is_staff, date_joined }  (email or phone may be null)

// email and phone: at least one is required; send null for the one not used.
// => { user, access, refresh }
// The backend returns tokens on sign-up too, so the user is logged in right away.
export async function registerUser({ first_name, last_name, email, phone, password }) {
  const response = await apiClient.post('/accounts/register/', {
    first_name, last_name, email, phone, password,
  });
  saveTokens(response.data);
  return response.data;
}

// identifier: email or mobile number, in any format the backend accepts.
// => { access, refresh, user }
// Wrong credentials: 401 with a Persian message in response.data.detail
export async function loginUser({ identifier, password }) {
  const response = await apiClient.post('/accounts/login/', {
    identifier, password,
  });
  saveTokens(response.data);
  return response.data;
}

export async function logoutUser() {
  const refresh = localStorage.getItem('refresh_token');
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  notifyAuthChanged();
  if (refresh) {
    // توکن refresh رو در بکند باطل کن؛ اگه قبلاً منقضی شده بود مهم نیست
    await apiClient.post('/accounts/logout/', { refresh }).catch(() => {});
  }
}

// => the currently logged-in user (same shape as above)
export async function getCurrentUser() {
  const response = await apiClient.get('/accounts/me/');
  return response.data;
}

// Edit the logged-in user. Send only the fields to change:
//   { first_name?, last_name?, email?, phone?, current_password? }
// email/phone: "" or null removes it (the other one must remain).
// Changing email or phone needs current_password.
// => the updated user (same shape as above). Invalid data: 400 with Persian messages per field.
export async function updateCurrentUser(fields) {
  const response = await apiClient.patch('/accounts/me/', fields);
  return response.data;
}

// Change the password: { current_password, new_password }.
// The server logs out every other device (blacklists all older refresh tokens) and
// returns new tokens for this one, which we keep. Invalid data: 400 with Persian
// messages per field (current_password, new_password).
export async function changePassword({ current_password, new_password }) {
  const response = await apiClient.post('/accounts/me/password/', { current_password, new_password });
  // Same user, only new tokens: no auth-changed event (nothing to reload)
  localStorage.setItem('access_token', response.data.access);
  localStorage.setItem('refresh_token', response.data.refresh);
}

// آیا refresh token داریم و هنوز منقضی نشده؟
// access token ممکن است منقضی باشد؛ مهم نیست، interceptor در client.js آن را با refresh تازه می‌کند.
// Used by ProtectedRoute and the navbar ("ورود" or "حساب").
export function isLoggedIn() {
  const token = localStorage.getItem('refresh_token');
  if (!token) return false;
  try {
    // بخش وسط JWT (payload) به شکل base64url است و زمان انقضا (exp، به ثانیه) را دارد.
    // این فقط برای تصمیم نمایش صفحه است؛ اعتبار واقعی توکن را همیشه بک‌اند بررسی می‌کند.
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
