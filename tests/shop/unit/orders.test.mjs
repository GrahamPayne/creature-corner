import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveNeedsFulfillment } from '../../../src/features/shop/admin/api.js';
import { orderMatchesFilter, matchesSearch } from '../../../src/features/shop/admin/ordersTable.js';

// "Needs Fulfillment" and the other order filters are derived from the
// payment_status/fulfillment_status/shipping_status columns added by
// supabase/migrations/005_orders_fulfillment.sql (see
// docs/ORDERS_FULFILLMENT_ARCHITECTURE.md) — no new status is invented here.

test('deriveNeedsFulfillment is true only for paid, not-yet-fulfilled/cancelled orders', () => {
  assert.equal(deriveNeedsFulfillment({ paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled' }), true);
  assert.equal(deriveNeedsFulfillment({ paymentStatus: 'paid', fulfillmentStatus: 'preparing' }), true);
  assert.equal(deriveNeedsFulfillment({ paymentStatus: 'pending', fulfillmentStatus: 'unfulfilled' }), false);
  assert.equal(deriveNeedsFulfillment({ paymentStatus: 'paid', fulfillmentStatus: 'fulfilled' }), false);
  assert.equal(deriveNeedsFulfillment({ paymentStatus: 'paid', fulfillmentStatus: 'cancelled' }), false);
});

test('orderMatchesFilter: "all" matches every order', () => {
  assert.equal(orderMatchesFilter({ paymentStatus: 'cancelled', fulfillmentStatus: 'cancelled', shippingStatus: 'label_not_purchased' }, 'all'), true);
});

test('orderMatchesFilter: "needs_fulfillment" matches only paid, not-yet-fulfilled orders', () => {
  assert.equal(orderMatchesFilter({ paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled' }, 'needs_fulfillment'), true);
  assert.equal(orderMatchesFilter({ paymentStatus: 'paid', fulfillmentStatus: 'fulfilled' }, 'needs_fulfillment'), false);
});

test('orderMatchesFilter: "unpaid" matches pending or failed payment status', () => {
  assert.equal(orderMatchesFilter({ paymentStatus: 'pending' }, 'unpaid'), true);
  assert.equal(orderMatchesFilter({ paymentStatus: 'failed' }, 'unpaid'), true);
  assert.equal(orderMatchesFilter({ paymentStatus: 'paid' }, 'unpaid'), false);
});

test('orderMatchesFilter: "shipped" matches shipped/in_transit/delivered shipping status', () => {
  assert.equal(orderMatchesFilter({ shippingStatus: 'shipped' }, 'shipped'), true);
  assert.equal(orderMatchesFilter({ shippingStatus: 'in_transit' }, 'shipped'), true);
  assert.equal(orderMatchesFilter({ shippingStatus: 'delivered' }, 'shipped'), true);
  assert.equal(orderMatchesFilter({ shippingStatus: 'label_not_purchased' }, 'shipped'), false);
});

test('orderMatchesFilter: "fulfilled" / "cancelled" / "refunded" / "test"', () => {
  assert.equal(orderMatchesFilter({ fulfillmentStatus: 'fulfilled' }, 'fulfilled'), true);
  assert.equal(orderMatchesFilter({ fulfillmentStatus: 'cancelled' }, 'cancelled'), true);
  assert.equal(orderMatchesFilter({ paymentStatus: 'cancelled' }, 'cancelled'), true);
  assert.equal(orderMatchesFilter({ paymentStatus: 'refunded' }, 'refunded'), true);
  assert.equal(orderMatchesFilter({ paymentStatus: 'partially_refunded' }, 'refunded'), true);
  assert.equal(orderMatchesFilter({ testMode: true }, 'test'), true);
  assert.equal(orderMatchesFilter({ testMode: false }, 'test'), false);
});

test('matchesSearch matches order number, customer name, email, or id (case-insensitive)', () => {
  const order = { orderNumber: 'CC-20261113-0007', customerName: 'Jane Doe', email: 'jane@example.com', id: 'abc-123' };
  assert.equal(matchesSearch(order, 'cc-20261113-0007'), true);
  assert.equal(matchesSearch(order, 'jane'), true);
  assert.equal(matchesSearch(order, 'EXAMPLE.COM'), true);
  assert.equal(matchesSearch(order, 'abc-123'), true);
  assert.equal(matchesSearch(order, 'no-match'), false);
});

test('matchesSearch with an empty query matches everything', () => {
  assert.equal(matchesSearch({ orderNumber: 'CC-1', customerName: 'A', email: 'a@b.com', id: '1' }, ''), true);
  assert.equal(matchesSearch({ orderNumber: 'CC-1', customerName: 'A', email: 'a@b.com', id: '1' }, '   '), true);
});
