import apiClient from './client';

// Only the cart Provider (src/context/CartProvider.jsx) calls checkout; components use useCart().checkout().
//
// POST /orders/checkout/ with NO body: the server buys exactly what is in the user's
// server-side cart, at the database's prices.
// 201 => { id, created_at, items: [{ book_id, title, price }], total, count }
// 400 { code: "empty_cart", detail }
// 409 { code: "cart_changed" | "already_owned", detail, cart }  (cart: the whole cart as it is now)
// 409 { code: "insufficient_balance", detail, shortfall }
export async function checkout() {
  const response = await apiClient.post('/orders/checkout/');
  return response.data;
}
