import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOrderNumber, parseOrderNumber } from '../../../src/features/shop/order/orderNumber.js';

test('formatOrderNumber builds CC-YYYYMMDD-NNNN, zero-padded', () => {
  assert.equal(formatOrderNumber({ year: 2026, month: 1, day: 5, sequence: 7 }), 'CC-20260105-0007');
});

test('formatOrderNumber pads single-digit month/day', () => {
  assert.equal(formatOrderNumber({ year: 2026, month: 3, day: 9, sequence: 1 }), 'CC-20260309-0001');
});

test('formatOrderNumber grows past 4-digit sequence without breaking', () => {
  assert.equal(formatOrderNumber({ year: 2026, month: 11, day: 13, sequence: 10000 }), 'CC-20261113-10000');
});

test('parseOrderNumber round-trips formatOrderNumber', () => {
  const parsed = parseOrderNumber('CC-20261113-0042');
  assert.deepEqual(parsed, { year: 2026, month: 11, day: 13, sequence: 42 });
});

test('parseOrderNumber returns null for a malformed order number', () => {
  assert.equal(parseOrderNumber('not-an-order-number'), null);
  assert.equal(parseOrderNumber(''), null);
  assert.equal(parseOrderNumber(undefined), null);
});
