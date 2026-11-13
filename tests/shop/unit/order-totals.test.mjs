import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSubtotalCents, computeOrderTotals } from '../../../src/features/shop/order/orderTotals.js';

test('computeSubtotalCents sums price * quantity in integer cents', () => {
  assert.equal(computeSubtotalCents([{ priceCents: 2500, quantity: 2 }, { priceCents: 1000, quantity: 1 }]), 6000);
});

test('computeSubtotalCents returns 0 for an empty cart', () => {
  assert.equal(computeSubtotalCents([]), 0);
});

test('computeOrderTotals: accurate totals with shipping, tax, and discount', () => {
  const totals = computeOrderTotals({
    items: [{ priceCents: 2500, quantity: 2 }],
    shippingCents: 800,
    taxCents: 350,
    discountCents: 500,
  });
  assert.deepEqual(totals, {
    subtotalCents: 5000,
    shippingCents: 800,
    taxCents: 350,
    discountCents: 500,
    totalCents: 5000 - 500 + 800 + 350,
  });
});

test('computeOrderTotals defaults shipping/tax/discount to 0', () => {
  const totals = computeOrderTotals({ items: [{ priceCents: 1000, quantity: 1 }] });
  assert.equal(totals.totalCents, 1000);
});

test('computeOrderTotals clamps a discount larger than the subtotal rather than going negative', () => {
  const totals = computeOrderTotals({ items: [{ priceCents: 1000, quantity: 1 }], discountCents: 5000 });
  assert.equal(totals.discountCents, 1000);
  assert.equal(totals.totalCents, 0);
});

test('computeOrderTotals rejects a negative or non-integer shippingCents/taxCents/discountCents', () => {
  assert.throws(() => computeOrderTotals({ items: [], shippingCents: -1 }));
  assert.throws(() => computeOrderTotals({ items: [], taxCents: 1.5 }));
  assert.throws(() => computeOrderTotals({ items: [], discountCents: -0.01 }));
});

test('computeOrderTotals never produces a float — every field is an integer', () => {
  const totals = computeOrderTotals({ items: [{ priceCents: 333, quantity: 3 }], shippingCents: 777, taxCents: 111 });
  for (const value of Object.values(totals)) {
    assert.ok(Number.isInteger(value), `expected integer cents, got ${value}`);
  }
});
