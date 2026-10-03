import apiClient from './client';

// توکن‌ها رو ذخیره کن تا در درخواست‌های بعدی استفاده بشن
function saveTokens({ access, refresh }) {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
}

// => { user: { id, username, email, date_joined }, access, refresh }
// بکند بعد از ثبت‌نام توکن هم برمی‌گردونه، پس کاربر همون لحظه وارد شده
export async function registerUser({ username, email, password }) {
  const response = await apiClient.post('/accounts/register/', {
    username, email, password,
  });
  saveTokens(response.data);
  return response.data;
}

// => { access, refresh, user: { id, username, email, date_joined } }
// اگه نام کاربری یا رمز اشتباه باشه، جنگو 401 برمی‌گردونه
export async function loginUser({ username, password }) {
  const response = await apiClient.post('/accounts/login/', {
    username, password,
  });
  saveTokens(response.data);
  return response.data;
}

export async function logoutUser() {
  const refresh = localStorage.getItem('refresh_token');
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  if (refresh) {
    // توکن refresh رو در بکند باطل کن؛ اگه قبلاً منقضی شده بود مهم نیست
    await apiClient.post('/accounts/logout/', { refresh }).catch(() => {});
  }
}

// => { id, username, email, date_joined } کاربری که الان وارد شده
export async function getCurrentUser() {
  const response = await apiClient.get('/accounts/me/');
  return response.data;
}
