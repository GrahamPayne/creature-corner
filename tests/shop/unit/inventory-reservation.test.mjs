import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailableQuantity, canReserve } from '../../../src/features/shop/order/inventoryReservation.js';

const NOW = new Date('2026-11-13T12:00:00Z');

test('computeAvailableQuantity subtracts active reservations from quantity', () => {
  const product = { quantity: 5 };
  const reservations = [{ quantity: 2, status: 'reserved' }];
  assert.equal(computeAvailableQuantity(product, reservations, NOW), 3);
});

test('computeAvailableQuantity ignores released/confirmed/expired reservations — only "reserved" is active', () => {
  const product = { quantity: 5 };
  const reservations = [
    { quantity: 2, status: 'released' },
    { quantity: 1, status: 'confirmed' },
    { quantity: 1, status: 'expired' },
  ];
  assert.equal(computeAvailableQuantity(product, reservations, NOW), 5);
});

test('computeAvailableQuantity ignores a reservation whose expiresAt is already in the past', () => {
  const product = { quantity: 1 };
  const reservations = [{ quantity: 1, status: 'reserved', expiresAt: '2026-11-13T11:00:00Z' }];
  assert.equal(computeAvailableQuantity(product, reservations, NOW), 1);
});

test('computeAvailableQuantity counts a reservation that has not expired yet', () => {
  const product = { quantity: 1 };
  const reservations = [{ quantity: 1, status: 'reserved', expiresAt: '2026-11-13T13:00:00Z' }];
  assert.equal(computeAvailableQuantity(product, reservations, NOW), 0);
});

test('computeAvailableQuantity never goes negative even if over-reserved', () => {
  const product = { quantity: 1 };
  const reservations = [{ quantity: 2, status: 'reserved' }, { quantity: 2, status: 'reserved' }];
  assert.equal(computeAvailableQuantity(product, reservations, NOW), 0);
});

test('canReserve: the core overselling scenario — two concurrent requests for the last unit of a quantity-1 item', () => {
  const product = { quantity: 1 };
  // First request (its own reservation not yet created) can reserve.
  assert.equal(canReserve(product, [], 1, NOW), true);
  // Once that reservation exists, a second concurrent request cannot.
  const afterFirstReservation = [{ quantity: 1, status: 'reserved' }];
  assert.equal(canReserve(product, afterFirstReservation, 1, NOW), false);
});

test('canReserve rejects a zero or negative requested quantity', () => {
  assert.equal(canReserve({ quantity: 5 }, [], 0, NOW), false);
  assert.equal(canReserve({ quantity: 5 }, [], -1, NOW), false);
});

test('canReserve allows reserving exactly the remaining quantity, not one more', () => {
  const product = { quantity: 3 };
  const reservations = [{ quantity: 1, status: 'reserved' }];
  assert.equal(canReserve(product, reservations, 2, NOW), true);
  assert.equal(canReserve(product, reservations, 3, NOW), false);
});
