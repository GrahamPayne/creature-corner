/**
 * Pure decision helpers mirroring reserve_inventory()'s logic (see
 * supabase/migrations/005_orders_fulfillment.sql) — the Postgres function
 * is the actual atomic enforcement (via SELECT ... FOR UPDATE row locking,
 * which only the database can do race-free), but the same arithmetic is
 * useful client-side for instant UI feedback ("only 1 left, and someone
 * else already has it reserved") and is independently unit-testable here
 * without a live database.
 */

/**
 * @param {{quantity: number}} product
 * @param {{quantity: number, status: string, expiresAt?: string}[]} reservations - this product's reservation rows
 * @param {Date} [now]
 */
export function computeAvailableQuantity(product, reservations, now = new Date()) {
  const activeReserved = reservations
    .filter((r) => r.status === 'reserved' && !(r.expiresAt && new Date(r.expiresAt) < now))
    .reduce((sum, r) => sum + r.quantity, 0);
  return Math.max(product.quantity - activeReserved, 0);
}

/**
 * @param {{quantity: number}} product
 * @param {{quantity: number, status: string, expiresAt?: string}[]} reservations
 * @param {number} requestedQuantity
 * @param {Date} [now]
 */
export function canReserve(product, reservations, requestedQuantity, now = new Date()) {
  if (requestedQuantity <= 0) return false;
  return computeAvailableQuantity(product, reservations, now) >= requestedQuantity;
}
