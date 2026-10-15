import axios from 'axios';

const BASE_URL = 'http://localhost:8000';

// آدرس بکند جنگو. مسیرها کامل نوشته می‌شوند، مثلاً '/accounts/login/' یا '/catalog/books/'
const apiClient = axios.create({
  baseURL: BASE_URL,
});

// این آدرس‌ها خودشان کار توکن را انجام می‌دهند؛ 401 در آن‌ها یعنی «رمز اشتباه»
// یا «refresh منقضی»، نه «access منقضی»، پس نباید سراغ refresh برویم.
const AUTH_URLS = ['/accounts/login/', '/accounts/register/', '/accounts/token/refresh/', '/accounts/logout/'];

// قبل از هر درخواست، اگه access token داریم، به هدر اضافه‌ش کن
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token && !config._skipAuth) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// اگه چند درخواست همزمان 401 بگیرن، فقط یک بار refresh می‌کنیم و بقیه منتظر همون می‌مونن
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    const refresh = localStorage.getItem('refresh_token');
    refreshPromise = (refresh
      // از axios خام استفاده می‌کنیم تا این درخواست از interceptorهای خودمون رد نشه
      ? axios.post(`${BASE_URL}/accounts/token/refresh/`, { refresh })
          .then((res) => {
            localStorage.setItem('access_token', res.data.access);
            return res.data.access;
          })
      : Promise.reject(new Error('No refresh token'))
    ).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// access token فقط ۳۰ دقیقه اعتبار داره. وقتی منقضی بشه جنگو 401 می‌ده؛
// اینجا با refresh token یه access جدید می‌گیریم و درخواست رو دوباره می‌فرستیم.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthUrl = AUTH_URLS.some((url) => original?.url?.startsWith(url));

    if (error.response?.status !== 401 || !original || original._retry || isAuthUrl) {
      return Promise.reject(error);
    }
    original._retry = true;

    try {
      const access = await refreshAccessToken();
      original.headers.Authorization = `Bearer ${access}`;
      return apiClient(original);
    } catch {
      // refresh هم منقضی یا باطل شده: کاربر باید دوباره وارد بشه.
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      // یک بار بدون توکن امتحان کن تا صفحه‌های عمومی (مثل لیست کتاب‌ها) باز هم کار کنن؛
      // اگه صفحه نیاز به ورود داشته باشه، همون 401 به کامپوننت می‌رسه.
      delete original.headers.Authorization;
      original._skipAuth = true;
      return apiClient(original);
    }
  },
);

export default apiClient;
