import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCents } from '../../../src/features/shop/money.js';

test('formatCents formats whole dollars', () => {
  assert.equal(formatCents(4800), '$48.00');
});

test('formatCents formats odd cent amounts', () => {
  assert.equal(formatCents(2299), '$22.99');
});

test('formatCents formats zero', () => {
  assert.equal(formatCents(0), '$0.00');
});
