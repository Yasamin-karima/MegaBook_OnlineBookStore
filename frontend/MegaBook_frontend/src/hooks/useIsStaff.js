import { useEffect, useState } from "react";
import { getCurrentUser, isLoggedIn } from "../api/auth";
import { AUTH_CHANGED } from "../api/authEvents";

// Is the logged-in user an admin (is_staff)? For showing the way into the admin
// dashboard (the side nav, the home page's top bar, the user dashboard):
//   const isStaff = useIsStaff();
//
// Only for showing a link: the dashboard itself is protected by StaffRoute and, for
// real, by the backend (404 for anyone who isn't staff).
//
// /accounts/me/ is asked once per login, not once per component or page: the answer is
// kept for the current refresh token, which changes on every login. Login, logout and
// an expired session (AUTH_CHANGED) ask again. A guest or any error means "no".
let cached = { token: null, promise: Promise.resolve(false) };

function staffStatus() {
  if (!isLoggedIn()) return Promise.resolve(false);
  const token = localStorage.getItem("refresh_token");
  if (cached.token !== token) {
    cached = {
      token,
      promise: getCurrentUser()
        .then((user) => Boolean(user.is_staff))
        .catch(() => {
          cached = { token: null, promise: Promise.resolve(false) }; // try again next time
          return false;
        }),
    };
  }
  return cached.promise;
}

export default function useIsStaff() {
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () => staffStatus().then((value) => active && setIsStaff(value));
    check();
    window.addEventListener(AUTH_CHANGED, check);
    return () => {
      active = false;
      window.removeEventListener(AUTH_CHANGED, check);
    };
  }, []);

  return isStaff;
}
