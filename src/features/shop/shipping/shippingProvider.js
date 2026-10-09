/**
 * Shipping provider abstraction (Stage 6.5). The cart never computes a
 * shipping price itself — it asks this module for a quote and renders
 * whatever comes back. Today that quote comes from the flat-rate system
 * (cart/shippingRules.js + cart/cartTotals.js); a future EasyPost-backed
 * provider implements the same `getShippingQuote` shape (called from a
 * server-side Cloudflare Pages Function, never the browser — see
 * docs/SHIPPING_ARCHITECTURE.md) and swaps in here with no cart changes.
 */
import { computeShippingCents } from '../cart/cartTotals.js';

/**
 * @param {{shippingClass: string}[]} items
 * @returns {boolean}
 */
function needsManualQuote(items) {
  return items.some((item) => item.shippingClass === 'special_quote');
}

/**
 * @param {{items: {shippingClass: string}[], fulfillment: 'shipping'|'pickup', rateByClass: Record<string, number|null>}} opts
 * @returns {{cents: number|null, configured: boolean, shippingClass: string|null, manualQuote: boolean}}
 */
export function getShippingQuote({ items, fulfillment, rateByClass }) {
  if (fulfillment === 'pickup') {
    return { cents: 0, configured: true, shippingClass: null, manualQuote: false };
  }

  // Checked before ranking: 'special_quote' isn't in shippingRules.js's
  // SHIP_RANK, so left to highestShippingClass() a cart containing ONLY a
  // special_quote item would rank nothing and silently fall through to
  // "no shippable class" (free shipping) — exactly the fake price this
  // mode exists to prevent. Checking first also makes a manual-quote item
  // dominate a mixed cart, regardless of what else is in it.
  if (needsManualQuote(items)) {
    return { cents: null, configured: false, shippingClass: 'special_quote', manualQuote: true };
  }

  const result = computeShippingCents(items, fulfillment, rateByClass);
  return { ...result, manualQuote: false };
}
