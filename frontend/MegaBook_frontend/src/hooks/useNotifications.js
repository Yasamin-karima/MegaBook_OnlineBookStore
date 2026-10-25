import { useContext } from "react";
import { NotificationsContext } from "../context/notificationsContext";

// The unread notification count, from anywhere in the app:
//   const { unread, refresh } = useNotifications();
// refresh() asks the server again (e.g. after marking notifications read).
export default function useNotifications() {
  const value = useContext(NotificationsContext);
  if (value === null) {
    throw new Error("useNotifications must be used inside <NotificationsProvider> (see main.jsx).");
  }
  return value;
}
