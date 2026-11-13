/**
 * Order financial math — integer cents throughout, never floats (same rule
 * as cart/cartTotals.js). This is the one place order totals are computed,
 * so every future payment provider and the admin UI agree on the same
 * number. Pure, no DOM/network — safe to call from a future server-side
 * checkout function or the browser-side admin test-order tool alike.
 */

/** @param {{priceCents: number, quantity: number}[]} items */
export function computeSubtotalCents(items) {
  return items.reduce((sum, item) => sum + Math.round(item.priceCents) * Math.round(item.quantity), 0);
}

/**
 * @param {{
 *   items: {priceCents: number, quantity: number}[],
 *   shippingCents?: number,
 *   taxCents?: number,
 *   discountCents?: number,
 * }} opts
 * @returns {{subtotalCents: number, shippingCents: number, taxCents: number, discountCents: number, totalCents: number}}
 */
export function computeOrderTotals({ items, shippingCents = 0, taxCents = 0, discountCents = 0 }) {
  /** @type {Record<string, number>} */
  const nonNegativeIntegers = { shippingCents, taxCents, discountCents };
  for (const label of Object.keys(nonNegativeIntegers)) {
    const value = nonNegativeIntegers[label];
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer (cents), got ${value}`);
  }

  const subtotalCents = computeSubtotalCents(items);
  // A discount can never exceed what it's discounting — clamped rather than
  // allowed to drive the total negative.
  const clampedDiscountCents = Math.min(discountCents, subtotalCents);
  const totalCents = subtotalCents - clampedDiscountCents + shippingCents + taxCents;

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    discountCents: clampedDiscountCents,
    totalCents,
  };
}
