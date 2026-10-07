import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSubtotalCents, computeShippingCents, computeTotalCents } from '../../../src/features/shop/cart/cartTotals.js';

const RATES = { small: 500, medium: 900, large: 1500, oversized: 4000 };

test('computeSubtotalCents sums price * quantity across items, integer cents only', () => {
  const items = [
    { priceCents: 4800, quantity: 1 },
    { priceCents: 2200, quantity: 2 },
  ];
  assert.equal(computeSubtotalCents(items), 4800 + 2200 * 2);
});

test('computeSubtotalCents is 0 for an empty cart', () => {
  assert.equal(computeSubtotalCents([]), 0);
});

test('computeShippingCents: pickup fulfillment is always free and configured', () => {
  const items = [{ shippingClass: 'oversized' }];
  assert.deepEqual(computeShippingCents(items, 'pickup', RATES), { cents: 0, configured: true, shippingClass: null });
});

test('computeShippingCents: shipping fulfillment uses the highest-ranked class present', () => {
  const items = [{ shippingClass: 'small' }, { shippingClass: 'medium' }];
  assert.deepEqual(computeShippingCents(items, 'shipping', RATES), { cents: 900, configured: true, shippingClass: 'medium' });
});

test('computeShippingCents: an unconfigured (null) rate is reported, not invented as 0 or guessed', () => {
  const items = [{ shippingClass: 'small' }];
  const rates = { small: null, medium: 900, large: 1500, oversized: 4000 };
  assert.deepEqual(computeShippingCents(items, 'shipping', rates), { cents: null, configured: false, shippingClass: 'small' });
});

test('computeTotalCents adds subtotal and shipping', () => {
  assert.equal(computeTotalCents(4800, 900), 5700);
});

test('computeTotalCents propagates null shipping (not yet configured) rather than silently treating it as 0', () => {
  assert.equal(computeTotalCents(4800, null), null);
});
