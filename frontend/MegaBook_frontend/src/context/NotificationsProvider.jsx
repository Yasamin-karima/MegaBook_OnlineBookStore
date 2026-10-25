import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { isLoggedIn } from "../api/auth";
import { AUTH_CHANGED } from "../api/authEvents";
import { getUnreadCount } from "../api/notifications";
import { NotificationsContext } from "./notificationsContext";

// ═════════════════════════════════════════════════════════════
// The one place that knows the unread notification count (the bells' badge).
//
// Asks GET /notifications/unread-count/ (one COUNT query on the server):
//   • on app start and on every route change;
//   • every 60 seconds, while the tab is visible.
// Only for a logged-in user: for a guest nothing is sent and the count is 0.
// On login/logout, or when the session expires (client.js announces AUTH_CHANGED when
// the refresh token stops working), the count is reset and asked again; any error is
// quiet: the badge simply shows nothing.
// ═════════════════════════════════════════════════════════════

const POLL_MS = 60_000;

export default function NotificationsProvider({ children }) {
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);
  // Bumped when the user changes: an answer for the previous user is ignored
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!isLoggedIn()) return;
    const gen = generation.current;
    try {
      const count = await getUnreadCount();
      if (gen === generation.current) setUnread(count);
    } catch {
      // Network error or expired session: keep quiet (AUTH_CHANGED resets the count)
    }
  }, []);

  // On start and on every route change
  useEffect(() => {
    // refresh() sets state only after an await, which this rule allows; the linter
    // can't see inside the function, so it flags the call itself.
    // oxlint-disable-next-line react/set-state-in-effect
    refresh();
  }, [pathname, refresh]);

  // Every minute, only while the tab is visible (refresh() itself skips guests)
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Login, logout, or a session that expired
  useEffect(() => {
    function onAuthChanged() {
      generation.current += 1;
      setUnread(0);
      refresh();
    }
    window.addEventListener(AUTH_CHANGED, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED, onAuthChanged);
  }, [refresh]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
