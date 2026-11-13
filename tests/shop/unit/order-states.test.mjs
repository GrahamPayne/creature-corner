import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionPayment,
  canTransitionFulfillment,
  canTransitionShipping,
  canMarkFulfilled,
  canCancelOrder,
  canRefundOrder,
  PAYMENT_STATUSES,
  FULFILLMENT_STATUSES,
  SHIPPING_STATUSES,
} from '../../../src/features/shop/order/orderStates.js';

test('canTransitionPayment allows the documented happy path', () => {
  assert.equal(canTransitionPayment('pending', 'paid'), true);
  assert.equal(canTransitionPayment('paid', 'refunded'), true);
  assert.equal(canTransitionPayment('paid', 'partially_refunded'), true);
  assert.equal(canTransitionPayment('partially_refunded', 'refunded'), true);
});

test('canTransitionPayment rejects invalid jumps', () => {
  assert.equal(canTransitionPayment('pending', 'refunded'), false, 'cannot refund something never paid');
  assert.equal(canTransitionPayment('refunded', 'paid'), false, 'refunded is terminal');
  assert.equal(canTransitionPayment('cancelled', 'paid'), false, 'cancelled is terminal');
});

test('canTransitionPayment treats setting the same status as a no-op-safe transition', () => {
  for (const s of PAYMENT_STATUSES) assert.equal(canTransitionPayment(s, s), true);
});

test('canTransitionFulfillment: fulfilled can only go back to unfulfilled (a correction), not to cancelled', () => {
  assert.equal(canTransitionFulfillment('fulfilled', 'unfulfilled'), true);
  assert.equal(canTransitionFulfillment('fulfilled', 'cancelled'), false);
});

test('canTransitionFulfillment: cancelled is terminal', () => {
  assert.equal(canTransitionFulfillment('cancelled', 'unfulfilled'), false);
  for (const s of FULFILLMENT_STATUSES) assert.equal(canTransitionFulfillment('cancelled', s), s === 'cancelled');
});

test('canTransitionShipping follows the documented chain and allows recovery from exception', () => {
  assert.equal(canTransitionShipping('label_not_purchased', 'label_created'), true);
  assert.equal(canTransitionShipping('label_not_purchased', 'shipped'), false, 'cannot skip straight to shipped');
  assert.equal(canTransitionShipping('shipped', 'exception'), true);
  assert.equal(canTransitionShipping('exception', 'shipped'), true);
  for (const s of SHIPPING_STATUSES) assert.equal(canTransitionShipping('delivered', s), s === 'delivered');
});

test('canMarkFulfilled requires payment_status paid for a real order', () => {
  assert.equal(canMarkFulfilled({ paymentStatus: 'paid' }), true);
  assert.equal(canMarkFulfilled({ paymentStatus: 'pending' }), false);
  assert.equal(canMarkFulfilled({ paymentStatus: 'failed' }), false);
});

test('canMarkFulfilled allows a test order regardless of payment_status', () => {
  assert.equal(canMarkFulfilled({ paymentStatus: 'pending', testMode: true }), true);
});

test('canCancelOrder: refunded and already-cancelled orders cannot be cancelled again', () => {
  assert.equal(canCancelOrder({ paymentStatus: 'pending' }), true);
  assert.equal(canCancelOrder({ paymentStatus: 'paid' }), true);
  assert.equal(canCancelOrder({ paymentStatus: 'refunded' }), false);
  assert.equal(canCancelOrder({ paymentStatus: 'cancelled' }), false);
});

test('canRefundOrder: only paid or partially-refunded orders are refundable', () => {
  assert.equal(canRefundOrder({ paymentStatus: 'paid' }), true);
  assert.equal(canRefundOrder({ paymentStatus: 'partially_refunded' }), true);
  assert.equal(canRefundOrder({ paymentStatus: 'pending' }), false);
  assert.equal(canRefundOrder({ paymentStatus: 'refunded' }), false);
});
