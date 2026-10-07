import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, removeItem, setItemQuantity, getTotalCount } from '../../../src/features/shop/cart/cart.js';

test('addItem adds a new product to an empty cart', () => {
  const cart = addItem([], 'p1', 1);
  assert.deepEqual(cart, [{ productId: 'p1', quantity: 1 }]);
});

test('addItem increments quantity for a product already in the cart', () => {
  const cart = addItem([{ productId: 'p1', quantity: 1 }], 'p1', 2);
  assert.deepEqual(cart, [{ productId: 'p1', quantity: 3 }]);
});

test('addItem never exceeds maxQuantity (available stock)', () => {
  const cart = addItem([{ productId: 'p1', quantity: 2 }], 'p1', 5, 3);
  assert.deepEqual(cart, [{ productId: 'p1', quantity: 3 }]);
});

test('addItem clamps a fresh add to maxQuantity too', () => {
  const cart = addItem([], 'p1', 10, 1);
  assert.deepEqual(cart, [{ productId: 'p1', quantity: 1 }]);
});

test('addItem leaves other products untouched', () => {
  const cart = addItem([{ productId: 'p1', quantity: 1 }], 'p2', 1);
  assert.deepEqual(cart, [
    { productId: 'p1', quantity: 1 },
    { productId: 'p2', quantity: 1 },
  ]);
});

test('removeItem removes only the matching product', () => {
  const cart = removeItem(
    [
      { productId: 'p1', quantity: 1 },
      { productId: 'p2', quantity: 2 },
    ],
    'p1'
  );
  assert.deepEqual(cart, [{ productId: 'p2', quantity: 2 }]);
});

test('setItemQuantity updates quantity, clamped to [1, maxQuantity]', () => {
  const base = [{ productId: 'p1', quantity: 1 }];
  assert.deepEqual(setItemQuantity(base, 'p1', 3, 5), [{ productId: 'p1', quantity: 3 }]);
  assert.deepEqual(setItemQuantity(base, 'p1', 10, 5), [{ productId: 'p1', quantity: 5 }]);
  assert.deepEqual(setItemQuantity(base, 'p1', 0, 5), [{ productId: 'p1', quantity: 1 }]);
  assert.deepEqual(setItemQuantity(base, 'p1', -5, 5), [{ productId: 'p1', quantity: 1 }]);
});

test('setItemQuantity rounds fractional input', () => {
  assert.deepEqual(setItemQuantity([{ productId: 'p1', quantity: 1 }], 'p1', 2.7, 10), [{ productId: 'p1', quantity: 3 }]);
});

test('getTotalCount sums quantities across all cart entries', () => {
  assert.equal(
    getTotalCount([
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 3 },
    ]),
    5
  );
});

test('getTotalCount is 0 for an empty cart', () => {
  assert.equal(getTotalCount([]), 0);
});
