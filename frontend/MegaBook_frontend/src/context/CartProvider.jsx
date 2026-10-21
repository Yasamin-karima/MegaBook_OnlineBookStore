import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedIn } from "../api/auth";
import { AUTH_CHANGED } from "../api/authEvents";
import {
  acknowledgeCartPrices,
  addCartItem,
  clearCart as clearCartRequest,
  getCart,
  removeCartItem,
} from "../api/cart";
import { checkout as checkoutRequest } from "../api/orders";
import { CartContext } from "./cartContext";

// ═════════════════════════════════════════════════════════════
// The one place that holds the cart and talks to the cart API.
//
// Wraps the whole app (main.jsx), so every component reads the SAME cart through
// useCart(): the navbar badge, the book page button and the cart page can never
// disagree. Components never call src/api/cart.js themselves.
//
// Every API call returns the whole cart; we replace our state with it and never
// compute totals or statuses here. The server is the source of truth.
// ═════════════════════════════════════════════════════════════

const NETWORK_ERROR = "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";

// An axios error -> { code, message } with the backend's Persian message when there is one
function toFailure(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  if (status === 401) return { code: "login_required", message: "برای استفاده از سبد خرید وارد شوید." };
  // A rule refused it: { code, detail } with a Persian message (400 empty_cart, 409 the rest)
  if ((status === 409 || status === 400) && data?.code && data?.detail) return { code: data.code, message: data.detail };
  if (status === 400 && data && typeof data === "object") {
    const first = Object.values(data).flat()[0];
    return { code: "invalid", message: String(first ?? NETWORK_ERROR) };
  }
  return { code: "network", message: NETWORK_ERROR };
}

export default function CartProvider({ children }) {
  // The last cart from the server, or null (guest, or not loaded yet)
  const [cart, setCart] = useState(null);
  // idle (guest) | loading | ready | error
  const [status, setStatus] = useState(() => (isLoggedIn() ? "loading" : "idle"));
  const [error, setError] = useState("");
  // Keys with a request in flight: a book id, or "all" for whole-cart actions.
  // The ref answers "already running?" instantly (state updates are async), so a
  // double-click sends one request; the state re-renders the buttons as disabled.
  const [pending, setPending] = useState(() => new Set());
  const pendingRef = useRef(new Set());
  // Bumped on login/logout: a response that arrives after the user changed is ignored,
  // so the previous user's cart can never appear for the next one
  const generation = useRef(0);

  const setKeyPending = useCallback((key, on) => {
    if (on) pendingRef.current.add(key);
    else pendingRef.current.delete(key);
    setPending(new Set(pendingRef.current));
  }, []);

  // Fetch the cart. Returns it (or null for a guest / on error).
  const refresh = useCallback(async () => {
    const gen = generation.current;
    // A guest has no cart. The empty state is already set: by the initial state, and
    // by onAuthChanged on logout. Setting it again here would only cause extra renders.
    if (!isLoggedIn()) return null;
    try {
      const data = await getCart();
      if (gen !== generation.current) return null;
      setCart(data);
      setStatus("ready");
      setError("");
      return data;
    } catch (err) {
      if (gen !== generation.current) return null;
      setStatus(isLoggedIn() ? "error" : "idle");
      setError(toFailure(err).message);
      return null;
    }
  }, []);

  // Run one cart action: skip if the same key is already running, put the returned
  // cart in state, and report { ok: true } or { ok: false, code, message }.
  const run = useCallback(
    async (key, request) => {
      if (!isLoggedIn()) return { ok: false, code: "login_required", message: "برای افزودن به سبد خرید وارد شوید." };
      if (pendingRef.current.has(key)) return { ok: false, code: "busy" };
      const gen = generation.current;
      setKeyPending(key, true);
      try {
        const data = await request();
        if (gen === generation.current) {
          setCart(data);
          setStatus("ready");
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, ...toFailure(err) };
      } finally {
        setKeyPending(key, false);
      }
    },
    [setKeyPending]
  );

  // Buy everything in the cart. { ok: true, data: order } or { ok: false, code, message,
  // shortfall?, cart? }. The server empties the cart on success, so we refetch it; on
  // 409 cart_changed the answer carries the current cart, which flags what changed.
  const checkout = useCallback(async () => {
    if (!isLoggedIn()) return { ok: false, code: "login_required", message: "برای خرید وارد شوید." };
    if (pendingRef.current.has("checkout")) return { ok: false, code: "busy" };
    const gen = generation.current;
    setKeyPending("checkout", true);
    try {
      const order = await checkoutRequest();
      await refresh();
      return { ok: true, data: order };
    } catch (err) {
      const data = err.response?.data;
      if (data?.cart && gen === generation.current) {
        setCart(data.cart);
        setStatus("ready");
      }
      return { ok: false, ...toFailure(err), shortfall: data?.shortfall, cart: data?.cart };
    } finally {
      setKeyPending("checkout", false);
    }
  }, [refresh, setKeyPending]);

  // Load on app start (if logged in), and again whenever the user changes
  useEffect(() => {
    // refresh() sets state only after `await getCart()` (asynchronously), which this rule
    // allows; the linter can't see inside the function, so it flags the call itself.
    // oxlint-disable-next-line react/set-state-in-effect
    refresh();
    function onAuthChanged() {
      generation.current += 1;
      setCart(null);
      setError("");
      setStatus(isLoggedIn() ? "loading" : "idle");
      refresh();
    }
    window.addEventListener(AUTH_CHANGED, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED, onAuthChanged);
  }, [refresh]);

  const value = useMemo(() => {
    const ids = new Set((cart?.items ?? []).map((item) => item.book.id));
    return {
      cart,
      status,
      error,
      count: cart?.count ?? 0,
      isInCart: (bookId) => ids.has(bookId),
      isPending: (key) => pending.has(key),
      refresh,
      addToCart: (bookId) => run(bookId, () => addCartItem(bookId)),
      removeFromCart: (bookId) => run(bookId, () => removeCartItem(bookId)),
      // bookId: accept one book's new price; no argument: all of them
      acknowledgePrices: (bookId) => run(bookId ?? "all", () => acknowledgeCartPrices(bookId)),
      clearCart: () => run("all", () => clearCartRequest()),
      checkout,
    };
  }, [cart, status, error, pending, refresh, run, checkout]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
