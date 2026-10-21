import { useContext } from "react";
import { CartContext } from "../context/cartContext";

// The cart, from anywhere in the app:
//   const { count, isInCart, isPending, addToCart, removeFromCart,
//           acknowledgePrices, clearCart, refresh, cart, status, error } = useCart();
// Actions resolve to { ok: true } or { ok: false, code, message } (message is Persian).
// code "login_required" means the user should be sent to /login.
export default function useCart() {
  const value = useContext(CartContext);
  if (value === null) {
    throw new Error("useCart must be used inside <CartProvider> (see main.jsx).");
  }
  return value;
}
