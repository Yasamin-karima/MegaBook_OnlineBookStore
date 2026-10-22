import apiClient from './client';

// Conversations with MegaBook support, one per request entry ("request") and per upload ("upload").
// Every call needs login, and only reaches the user's OWN entries and uploads (404 otherwise).
const base = (kind, id) => `/support/${kind === 'request' ? 'requests' : 'uploads'}/${id}`;

// => { item, conversation: { state: "open" | "closed", closed_kind: null | "fulfilled" | "support",
//      user_last_read_at }, messages: [{ id, sender: "me" | "support" | "system", text, created_at }] }
// after: only messages with a larger id (for polling). No conversation yet: open, no messages.
export async function getConversation(kind, id, after) {
  const response = await apiClient.get(`${base(kind, id)}/`, { params: after ? { after } : {} });
  return response.data;
}

// => the saved message. 409 { detail }: the conversation is closed. 429: too many messages.
// Only the text is sent: the server decides the sender, it can't be faked from here.
export async function sendMessage(kind, id, text) {
  const response = await apiClient.post(`${base(kind, id)}/messages/`, { text });
  return response.data;
}

// The user has seen everything up to now (unread counts are computed from this moment)
export async function markRead(kind, id) {
  await apiClient.post(`${base(kind, id)}/read/`);
}

// => { requests: { entryId: n }, uploads: { bookId: n } } (only non-zero), for list badges
export async function getUnread() {
  const response = await apiClient.get('/support/unread/');
  return response.data;
}
