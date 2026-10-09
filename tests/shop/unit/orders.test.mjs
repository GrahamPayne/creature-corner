import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveNeedsFulfillment } from '../../../src/features/shop/admin/api.js';
import { orderMatchesFilter } from '../../../src/features/shop/admin/ordersTable.js';

// "Needs Fulfillment" and the other order filters are derived entirely from
// the existing orders.status/fulfillment_type columns (see
// docs/ORDERS_AND_PACKING_SLIP.md) — no new status is ever invented here.

test('deriveNeedsFulfillment is true only for paid, not-yet-fulfilled orders', () => {
  assert.equal(deriveNeedsFulfillment({ status: 'paid' }), true);
  assert.equal(deriveNeedsFulfillment({ status: 'pending' }), false);
  assert.equal(deriveNeedsFulfillment({ status: 'fulfilled' }), false);
  assert.equal(deriveNeedsFulfillment({ status: 'cancelled' }), false);
  assert.equal(deriveNeedsFulfillment({ status: 'refunded' }), false);
});

test('orderMatchesFilter: "all" matches every order', () => {
  assert.equal(orderMatchesFilter({ status: 'cancelled', fulfillmentType: 'pickup' }, 'all'), true);
});

test('orderMatchesFilter: "needs_fulfillment" matches only paid orders', () => {
  assert.equal(orderMatchesFilter({ status: 'paid' }, 'needs_fulfillment'), true);
  assert.equal(orderMatchesFilter({ status: 'fulfilled' }, 'needs_fulfillment'), false);
});

test('orderMatchesFilter: "shipping" and "pickup" match on fulfillmentType', () => {
  assert.equal(orderMatchesFilter({ fulfillmentType: 'shipping' }, 'shipping'), true);
  assert.equal(orderMatchesFilter({ fulfillmentType: 'pickup' }, 'shipping'), false);
  assert.equal(orderMatchesFilter({ fulfillmentType: 'pickup' }, 'pickup'), true);
});

test('orderMatchesFilter: "fulfilled"/"cancelled"/"refunded" match on status', () => {
  assert.equal(orderMatchesFilter({ status: 'fulfilled' }, 'fulfilled'), true);
  assert.equal(orderMatchesFilter({ status: 'cancelled' }, 'cancelled'), true);
  assert.equal(orderMatchesFilter({ status: 'refunded' }, 'refunded'), true);
  assert.equal(orderMatchesFilter({ status: 'paid' }, 'fulfilled'), false);
});
