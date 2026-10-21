// Announces "the logged-in user changed" (login, sign-up, logout, or a session that
// expired when the refresh token stopped working) to anything that listens, e.g. the
// cart Provider, which then loads the new user's cart or forgets the old one.
//
// A separate module so both auth.js and client.js can import it without importing
// each other (auth.js already imports client.js).
export const AUTH_CHANGED = "megabook:auth-changed";

export function notifyAuthChanged() {
  window.dispatchEvent(new Event(AUTH_CHANGED));
}
