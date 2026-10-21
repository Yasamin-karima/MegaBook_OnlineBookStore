import { createContext } from "react";

// The "channel" the cart travels on. CartProvider puts the cart and its actions on it;
// components read them with useCart() (src/hooks/useCart.js).
export const CartContext = createContext(null);
