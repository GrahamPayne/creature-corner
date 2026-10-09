import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAvailabilityLabel, getAvailabilityVariant, getFulfillmentSummary } from '../../../src/features/shop/availability.js';

const base = { status: 'available', quantity: 1, shippingClass: 'medium', pickupAvailable: false };

test('getAvailabilityLabel: ordinary shippable product is AVAILABLE', () => {
  assert.equal(getAvailabilityLabel(base), 'Available');
  assert.equal(getAvailabilityVariant(base), 'available');
});

test('getAvailabilityLabel: sold status always wins', () => {
  assert.equal(getAvailabilityLabel({ ...base, status: 'sold' }), 'Sold');
  assert.equal(getAvailabilityVariant({ ...base, status: 'sold' }), 'sold');
});

test('getAvailabilityLabel: quantity 0 counts as sold even if status says available', () => {
  assert.equal(getAvailabilityLabel({ ...base, quantity: 0 }), 'Sold');
});

test('getAvailabilityLabel: pickup_only shows Local Pickup Only', () => {
  assert.equal(getAvailabilityLabel({ ...base, shippingClass: 'pickup_only' }), 'Local Pickup Only');
  assert.equal(getAvailabilityVariant({ ...base, shippingClass: 'pickup_only' }), 'pickup-only');
});

test('getAvailabilityLabel: special_quote shows Special Shipping', () => {
  assert.equal(getAvailabilityLabel({ ...base, shippingClass: 'special_quote' }), 'Special Shipping');
  assert.equal(getAvailabilityVariant({ ...base, shippingClass: 'special_quote' }), 'special-shipping');
});

test('getAvailabilityLabel: sold overrides pickup_only and special_quote', () => {
  assert.equal(getAvailabilityLabel({ ...base, status: 'sold', shippingClass: 'pickup_only' }), 'Sold');
  assert.equal(getAvailabilityLabel({ ...base, status: 'sold', shippingClass: 'special_quote' }), 'Sold');
});

test('getFulfillmentSummary: special_quote', () => {
  assert.equal(getFulfillmentSummary({ shippingClass: 'special_quote', pickupAvailable: false }), 'Special Shipping — Contact for Quote');
});

test('getFulfillmentSummary: pickup_only', () => {
  assert.equal(getFulfillmentSummary({ shippingClass: 'pickup_only', pickupAvailable: true }), 'Local Pickup Only');
});

test('getFulfillmentSummary: shippable with pickup enabled', () => {
  assert.equal(getFulfillmentSummary({ shippingClass: 'medium', pickupAvailable: true }), 'Ships + Local Pickup');
});

test('getFulfillmentSummary: shippable, pickup disabled', () => {
  assert.equal(getFulfillmentSummary({ shippingClass: 'medium', pickupAvailable: false }), 'Ships Only');
});
