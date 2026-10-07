import { highestShippingClass } from './shippingRules.js';

/** Integer-cents math throughout — never floats for money. @param {{priceCents: number, quantity: number}[]} items */
export function computeSubtotalCents(items) {
  return items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
}

/**
 * @param {{shippingClass: string}[]} items
 * @param {'shipping'|'pickup'} fulfillment
 * @param {Record<string, number|null>} rateByClass - shipping_classes.flat_price_cents keyed by class key
 * @returns {{cents: number|null, configured: boolean, shippingClass: string|null}} configured=false means the admin hasn't set this class's rate yet (supabase/schema.sql seeds it as null) — never invent a number in that case.
 */
export function computeShippingCents(items, fulfillment, rateByClass) {
  if (fulfillment === 'pickup') return { cents: 0, configured: true, shippingClass: null };

  const cls = highestShippingClass(items);
  if (!cls) return { cents: 0, configured: true, shippingClass: null };

  const rate = rateByClass[cls];
  if (rate === null || rate === undefined) return { cents: null, configured: false, shippingClass: cls };
  return { cents: rate, configured: true, shippingClass: cls };
}

/** @param {number} subtotalCents @param {number|null} shippingCents */
export function computeTotalCents(subtotalCents, shippingCents) {
  return shippingCents === null ? null : subtotalCents + shippingCents;
}
