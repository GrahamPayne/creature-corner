/**
 * Cart storage: localStorage holds ONLY {productId, quantity} pairs — never
 * price, name, image, or availability. Every page that renders the cart
 * re-fetches current product data from Supabase (see pages/cart.js), so a
 * stale/tampered localStorage value can never show a wrong price or let
 * someone "buy" something that's since sold out — it can only ever point
 * at a product id, which gets re-validated on every read.
 *
 * Pure reducer-style functions (addItem/removeItem/setItemQuantity/
 * getTotalCount) take and return plain arrays with no localStorage access,
 * so they're unit-testable directly. The read/write wrapper functions below
 * them are the only part that touches localStorage.
 */

export const CART_STORAGE_KEY = 'cc-cart';

/**
 * @param {{productId: string, quantity: number}[]} cart
 * @param {string} productId
 * @param {number} quantity
 * @param {number} [maxQuantity]
 */
export function addItem(cart, productId, quantity, maxQuantity = Infinity) {
  const existing = cart.find((i) => i.productId === productId);
  if (existing) {
    const next = Math.min(existing.quantity + quantity, maxQuantity);
    return cart.map((i) => (i.productId === productId ? { ...i, quantity: next } : i));
  }
  const qty = Math.min(Math.max(quantity, 1), maxQuantity);
  return [...cart, { productId, quantity: qty }];
}

/** @param {{productId: string, quantity: number}[]} cart @param {string} productId */
export function removeItem(cart, productId) {
  return cart.filter((i) => i.productId !== productId);
}

/** @param {{productId: string, quantity: number}[]} cart @param {string} productId @param {number} quantity @param {number} [maxQuantity] */
export function setItemQuantity(cart, productId, quantity, maxQuantity = Infinity) {
  const qty = Math.min(Math.max(Math.round(quantity), 1), maxQuantity);
  return cart.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i));
}

/** @param {{productId: string, quantity: number}[]} cart */
export function getTotalCount(cart) {
  return cart.reduce((sum, i) => sum + i.quantity, 0);
}

// ---- localStorage I/O (browser only) ----

function isValidEntry(entry) {
  return (
    entry &&
    typeof entry.productId === 'string' &&
    entry.productId.length > 0 &&
    Number.isFinite(entry.quantity) &&
    entry.quantity > 0
  );
}

/** @returns {{productId: string, quantity: number}[]} */
export function readCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

/** @param {{productId: string, quantity: number}[]} cart */
export function writeCart(cart) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage unavailable (private browsing, quota, disabled) — the cart
    // simply won't persist; nothing to recover from client-side.
  }
}

export function addToCart(productId, quantity = 1, maxQuantity = Infinity) {
  const cart = addItem(readCart(), productId, quantity, maxQuantity);
  writeCart(cart);
  return cart;
}

export function removeFromCart(productId) {
  const cart = removeItem(readCart(), productId);
  writeCart(cart);
  return cart;
}

export function updateCartQuantity(productId, quantity, maxQuantity = Infinity) {
  const cart = setItemQuantity(readCart(), productId, quantity, maxQuantity);
  writeCart(cart);
  return cart;
}

export function clearCart() {
  writeCart([]);
}

export function getCartCount() {
  return getTotalCount(readCart());
}
