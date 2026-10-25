import { createContext } from "react";

// The unread notification count for the bells. NotificationsProvider puts it here;
// components read it with useNotifications() (src/hooks/useNotifications.js).
export const NotificationsContext = createContext(null);
