/**
 * Flat-rate shipping rules for Stage 6. See docs/SHOP_SETUP.md for the
 * reasoning. Pure functions — no network, no DOM — operate on already-
 * fetched product data (each item must carry `shippingClass` and
 * `pickupAvailable`, i.e. the shape api/products.js returns).
 */

/** Ascending size order — intentionally fixed in code, not the database:
 * these five classes are a closed set defined in supabase/schema.sql, not
 * something admins add to, so ranking them here isn't "hardcoding a
 * price" (the actual rates stay entirely in shipping_classes). */
export const SHIP_RANK = ['small', 'medium', 'large', 'oversized'];

/** @param {{shippingClass: string}} item */
export function canShip(item) {
  return item.shippingClass !== 'pickup_only';
}

/** @param {{pickupAvailable: boolean}} item */
export function canPickup(item) {
  return item.pickupAvailable === true;
}

/**
 * The highest-ranked shippable class among the cart's items — e.g.
 * small + medium -> medium, medium + large -> large. Returns null if
 * nothing in the cart can ship (either it's empty or every item is
 * pickup_only).
 * @param {{shippingClass: string}[]} items
 */
export function highestShippingClass(items) {
  let best = null;
  let bestRank = -1;
  for (const item of items) {
    if (!canShip(item)) continue;
    const rank = SHIP_RANK.indexOf(item.shippingClass);
    if (rank > bestRank) {
      bestRank = rank;
      best = item.shippingClass;
    }
  }
  return best;
}

/**
 * Whether Shipping and/or Local Pickup can be offered for this whole cart,
 * and whether the cart has an unresolvable mix (some items can only ship,
 * others can only be picked up).
 * @param {{shippingClass: string, pickupAvailable: boolean}[]} items
 * @returns {{shippingAvailable: boolean, pickupAvailable: boolean, conflict: boolean}}
 */
export function determineFulfillmentOptions(items) {
  if (items.length === 0) return { shippingAvailable: false, pickupAvailable: false, conflict: false };
  const shippingAvailable = items.every(canShip);
  const pickupAvailable = items.every(canPickup);
  return { shippingAvailable, pickupAvailable, conflict: !shippingAvailable && !pickupAvailable };
}
