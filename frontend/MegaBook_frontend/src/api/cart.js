import apiClient from './client';

// Only the cart Provider (src/context/CartProvider.jsx) calls these; components use useCart().
//
// Every call returns the WHOLE cart, in the same shape:
// {
//   items: [{ book: { id, title, authors, cover, price, is_free },
//             price_seen, status: "ok" | "price_changed" | "unavailable", added_at }],
//   removed: [{ book_id, title }],   // owned books the server just took out of the cart
//   count, total, balance             // total: current prices of buyable items, in toman
// }
// Only book ids are ever sent: prices always come from the server's database.

export async function getCart() {
  const response = await apiClient.get('/cart/');
  return response.data;
}

// 201 added / 200 was already in the cart. 409 { code, detail } when it can't be added:
// code is "not_available" | "own_upload" | "already_owned" | "cart_full"
export async function addCartItem(bookId) {
  const response = await apiClient.post('/cart/items/', { book_id: bookId });
  return response.data;
}

export async function removeCartItem(bookId) {
  const response = await apiClient.delete(`/cart/items/${bookId}/`);
  return response.data;
}

// The user saw the new price. bookId: one book; omitted: every price_changed item
export async function acknowledgeCartPrices(bookId) {
  const response = await apiClient.post('/cart/acknowledge-prices/', bookId ? { book_id: bookId } : {});
  return response.data;
}

export async function clearCart() {
  const response = await apiClient.delete('/cart/');
  return response.data;
}
