import { getCartCount } from './cart.js';

/** Updates the nav's "CART (n)" badge, if this page has one. Call after any cart mutation and once on page load. */
export function syncNavBadge() {
  const el = document.getElementById('nav-cart-count');
  if (!el) return;
  const count = getCartCount();
  el.textContent = count > 0 ? `(${count})` : '';
}
