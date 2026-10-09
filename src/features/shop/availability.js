/**
 * Shared availability/fulfillment language for the public shop — one
 * place so the product card and product detail page never drift apart
 * (Stage 6.75). Pure, no DOM/network.
 */

/** @param {{status: string, quantity: number}} product */
function isSold(product) {
  return product.status === 'sold' || product.quantity <= 0;
}

/**
 * Title Case on purpose, matching the existing .specimen-status/.specimen-badge
 * convention — both already apply `text-transform: uppercase` in CSS, so
 * the DOM text content stays Title Case (readable in dev tools / to
 * screen readers) while the on-page presentation is still ALL CAPS.
 * @param {{status: string, quantity: number, shippingClass: string}} product
 * @returns {'Available'|'Sold'|'Local Pickup Only'|'Special Shipping'}
 */
export function getAvailabilityLabel(product) {
  if (isSold(product)) return 'Sold';
  if (product.shippingClass === 'special_quote') return 'Special Shipping';
  if (product.shippingClass === 'pickup_only') return 'Local Pickup Only';
  return 'Available';
}

/**
 * CSS class key matching getAvailabilityLabel, for both
 * `.specimen-status.<variant>` (card) and `.specimen-badge.<variant>` (detail).
 * @param {{status: string, quantity: number, shippingClass: string}} product
 * @returns {'available'|'sold'|'pickup-only'|'special-shipping'}
 */
export function getAvailabilityVariant(product) {
  if (isSold(product)) return 'sold';
  if (product.shippingClass === 'special_quote') return 'special-shipping';
  if (product.shippingClass === 'pickup_only') return 'pickup-only';
  return 'available';
}

/**
 * One-line fulfillment summary for the product detail page — replaces
 * two separate Shipping/Local Pickup data boxes that otherwise repeat
 * the same information.
 * @param {{shippingClass: string, pickupAvailable: boolean}} product
 */
export function getFulfillmentSummary(product) {
  if (product.shippingClass === 'special_quote') return 'Special Shipping — Contact for Quote';
  if (product.shippingClass === 'pickup_only') return 'Local Pickup Only';
  return product.pickupAvailable ? 'Ships + Local Pickup' : 'Ships Only';
}
