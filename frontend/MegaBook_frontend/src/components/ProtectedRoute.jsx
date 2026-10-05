import { Navigate, useLocation } from "react-router-dom";

// آیا refresh token داریم و هنوز منقضی نشده؟
// access token ممکن است منقضی باشد؛ مهم نیست، interceptor در client.js آن را با refresh تازه می‌کند.
function hasValidRefreshToken() {
  const token = localStorage.getItem("refresh_token");
  if (!token) return false;
  try {
    // بخش وسط JWT (payload) به شکل base64url است و زمان انقضا (exp، به ثانیه) را دارد.
    // این فقط برای تصمیم نمایش صفحه است؛ اعتبار واقعی توکن را همیشه بک‌اند بررسی می‌کند.
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// صفحه‌هایی که ورود لازم دارند داخل این کامپوننت قرار می‌گیرند:
//   <ProtectedRoute><AddBookWizard /></ProtectedRoute>
// کاربر واردنشده به /login فرستاده می‌شود و آدرس فعلی در state می‌ماند تا بعد از ورود برگردد.
export default function ProtectedRoute({ children }) {
  const location = useLocation();
  if (!hasValidRefreshToken()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
