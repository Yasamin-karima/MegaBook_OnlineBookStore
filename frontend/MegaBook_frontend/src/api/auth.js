import apiClient from './client';

export async function registerUser(username, email, password) {
  const response = await apiClient.post('/accounts/register/', {
    username, email, password,
  });
  return response.data;
}

export async function loginUser(username, password) {
  const response = await apiClient.post('/accounts/login/', {
    username, password,
  });
  // توکن‌ها رو ذخیره کن تا در درخواست‌های بعدی استفاده بشن
  localStorage.setItem('access_token', response.data.access);
  localStorage.setItem('refresh_token', response.data.refresh);
  return response.data;
}