import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getCurrentUser, isLoggedIn } from "../api/auth";
import { AUTH_CHANGED } from "../api/authEvents";

// The admin dashboard's pages sit inside this, like ProtectedRoute but for staff:
//   not logged in -> /login (and back here afterwards)
//   logged in but not staff -> the home page
// This is only for the look of things: the real protection is the backend, where every
// /admin-api/ endpoint answers 404 to anyone who isn't staff.
export default function StaffRoute({ children }) {
  const location = useLocation();
  const loggedIn = isLoggedIn();
  // null = still asking /accounts/me/
  const [isStaff, setIsStaff] = useState(null);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    const check = () =>
      getCurrentUser()
        .then((user) => !cancelled && setIsStaff(Boolean(user.is_staff)))
        .catch(() => !cancelled && setIsStaff(false));
    check();
    // Logged out (or another account logged in) in another tab
    window.addEventListener(AUTH_CHANGED, check);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED, check);
    };
  }, [loggedIn]);

  if (!loggedIn) return <Navigate to="/login" replace state={{ from: location }} />;
  if (isStaff === null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-100 text-sm text-gray-400" dir="rtl" aria-busy="true">
        در حال بارگذاری…
      </div>
    );
  }
  if (!isStaff) return <Navigate to="/" replace />;
  return children;
}
