import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canShip, canPickup, highestShippingClass, determineFulfillmentOptions } from '../../../src/features/shop/cart/shippingRules.js';

test('canShip is false only for pickup_only items', () => {
  assert.equal(canShip({ shippingClass: 'small' }), true);
  assert.equal(canShip({ shippingClass: 'oversized' }), true);
  assert.equal(canShip({ shippingClass: 'pickup_only' }), false);
});

test('canPickup reflects the pickupAvailable flag directly', () => {
  assert.equal(canPickup({ pickupAvailable: true }), true);
  assert.equal(canPickup({ pickupAvailable: false }), false);
});

test('highestShippingClass: small + medium -> medium', () => {
  assert.equal(highestShippingClass([{ shippingClass: 'small' }, { shippingClass: 'medium' }]), 'medium');
});

test('highestShippingClass: medium + large -> large', () => {
  assert.equal(highestShippingClass([{ shippingClass: 'medium' }, { shippingClass: 'large' }]), 'large');
});

test('highestShippingClass: large + oversized -> oversized', () => {
  assert.equal(highestShippingClass([{ shippingClass: 'large' }, { shippingClass: 'oversized' }]), 'oversized');
});

test('highestShippingClass: a single item just returns its own class', () => {
  assert.equal(highestShippingClass([{ shippingClass: 'small' }]), 'small');
});

test('highestShippingClass ignores pickup_only items when picking the shippable max', () => {
  assert.equal(highestShippingClass([{ shippingClass: 'pickup_only' }, { shippingClass: 'small' }]), 'small');
});

test('highestShippingClass returns null when nothing is shippable', () => {
  assert.equal(highestShippingClass([{ shippingClass: 'pickup_only' }]), null);
  assert.equal(highestShippingClass([]), null);
});

test('determineFulfillmentOptions: empty cart offers neither, no conflict', () => {
  assert.deepEqual(determineFulfillmentOptions([]), { shippingAvailable: false, pickupAvailable: false, conflict: false });
});

test('determineFulfillmentOptions: ordinary shippable + pickup-eligible item offers both', () => {
  const items = [{ shippingClass: 'small', pickupAvailable: true }];
  assert.deepEqual(determineFulfillmentOptions(items), { shippingAvailable: true, pickupAvailable: true, conflict: false });
});

test('determineFulfillmentOptions: pickup_only item with pickupAvailable true offers pickup only', () => {
  const items = [{ shippingClass: 'pickup_only', pickupAvailable: true }];
  assert.deepEqual(determineFulfillmentOptions(items), { shippingAvailable: false, pickupAvailable: true, conflict: false });
});

test('determineFulfillmentOptions: shippable item with pickup disabled offers shipping only', () => {
  const items = [{ shippingClass: 'small', pickupAvailable: false }];
  assert.deepEqual(determineFulfillmentOptions(items), { shippingAvailable: true, pickupAvailable: false, conflict: false });
});

test('determineFulfillmentOptions: pickup_only item mixed with a non-pickup-eligible item is an unresolvable conflict', () => {
  const items = [
    { shippingClass: 'pickup_only', pickupAvailable: true },
    { shippingClass: 'small', pickupAvailable: false },
  ];
  assert.deepEqual(determineFulfillmentOptions(items), { shippingAvailable: false, pickupAvailable: false, conflict: true });
});
