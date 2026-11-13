/**
 * Order lifecycle state machine — pure, no DOM/network. Payment,
 * fulfillment, and shipping are three separate state tracks (section G:
 * "do not combine these into one ambiguous status") with their own valid
 * transitions. The admin UI and any future server-side action (webhook
 * handler, checkout function) both call these same functions, so "is this
 * transition allowed" is answered in exactly one place.
 */

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded'];
export const FULFILLMENT_STATUSES = ['unfulfilled', 'preparing', 'fulfilled', 'cancelled'];
export const SHIPPING_STATUSES = ['label_not_purchased', 'label_created', 'shipped', 'in_transit', 'delivered', 'exception'];

/** @type {Record<string, string[]>} */
const PAYMENT_TRANSITIONS = {
  pending: ['paid', 'failed', 'cancelled'],
  paid: ['partially_refunded', 'refunded'],
  failed: ['pending'], // a retried payment attempt
  cancelled: [],
  partially_refunded: ['refunded'],
  refunded: [],
};

/** @type {Record<string, string[]>} */
const FULFILLMENT_TRANSITIONS = {
  unfulfilled: ['preparing', 'fulfilled', 'cancelled'],
  preparing: ['fulfilled', 'unfulfilled', 'cancelled'],
  fulfilled: ['unfulfilled'], // "mark unfulfilled" correction, e.g. a mis-click
  cancelled: [],
};

/** @type {Record<string, string[]>} */
const SHIPPING_TRANSITIONS = {
  label_not_purchased: ['label_created'],
  label_created: ['shipped', 'exception'],
  shipped: ['in_transit', 'delivered', 'exception'],
  in_transit: ['delivered', 'exception'],
  delivered: [],
  exception: ['label_created', 'shipped'], // recoverable (re-label, carrier resolved it)
};

function canTransition(transitions, from, to) {
  if (from === to) return true; // re-setting the same value is always a no-op-safe "transition"
  return Boolean(transitions[from]?.includes(to));
}

/** @param {string} from @param {string} to */
export function canTransitionPayment(from, to) {
  return canTransition(PAYMENT_TRANSITIONS, from, to);
}

/** @param {string} from @param {string} to */
export function canTransitionFulfillment(from, to) {
  return canTransition(FULFILLMENT_TRANSITIONS, from, to);
}

/** @param {string} from @param {string} to */
export function canTransitionShipping(from, to) {
  return canTransition(SHIPPING_TRANSITIONS, from, to);
}

/**
 * The one hard rule section F calls out explicitly: marking an order
 * Fulfilled must never also mark an unpaid order Paid, and an order that
 * was never paid should not normally be marked fulfilled at all (a test
 * order is the one deliberate exception — see Safe Test Mode).
 * @param {{paymentStatus: string, testMode?: boolean}} order
 */
export function canMarkFulfilled(order) {
  return order.testMode === true || order.paymentStatus === 'paid';
}

/** @param {{paymentStatus: string}} order */
export function canCancelOrder(order) {
  return order.paymentStatus !== 'refunded' && order.paymentStatus !== 'cancelled';
}

/** @param {{paymentStatus: string}} order */
export function canRefundOrder(order) {
  return order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded';
}
