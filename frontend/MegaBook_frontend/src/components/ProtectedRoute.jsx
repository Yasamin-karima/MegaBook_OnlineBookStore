import { Navigate, useLocation } from "react-router-dom";
import { isLoggedIn } from "../api/auth";

// صفحه‌هایی که ورود لازم دارند داخل این کامپوننت قرار می‌گیرند:
//   <ProtectedRoute><AddBookWizard /></ProtectedRoute>
// کاربر واردنشده به /login فرستاده می‌شود و آدرس فعلی در state می‌ماند تا بعد از ورود برگردد.
export default function ProtectedRoute({ children }) {
  const location = useLocation();
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
