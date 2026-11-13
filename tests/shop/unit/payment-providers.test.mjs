import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementsPaymentProviderContract, ProviderNotConfiguredError } from '../../../src/features/shop/payments/paymentProvider.js';
import { testProvider } from '../../../src/features/shop/payments/providers/testProvider.js';
import { stripeProvider } from '../../../src/features/shop/payments/providers/stripeProvider.js';
import { paypalProvider } from '../../../src/features/shop/payments/providers/paypalProvider.js';
import { getPaymentProvider, PAYMENT_PROVIDERS } from '../../../src/features/shop/payments/providerRegistry.js';

test('every registered payment provider implements the full PaymentProvider contract', () => {
  for (const [name, provider] of Object.entries(PAYMENT_PROVIDERS)) {
    assert.equal(implementsPaymentProviderContract(provider), true, `${name} is missing part of the PaymentProvider interface`);
  }
});

test('getPaymentProvider returns the provider by name, and throws for an unknown one', () => {
  assert.equal(getPaymentProvider('test'), testProvider);
  assert.throws(() => getPaymentProvider('square'));
});

test('testProvider.createSession never touches a real network — returns a fake, clearly-test reference synchronously resolvable', async () => {
  const session = await testProvider.createSession({ id: 'order-1', totalCents: 2500, currency: 'usd', email: 'a@b.com' });
  assert.equal(session.provider, 'test');
  assert.match(session.reference, /^test_session_/);
});

test('testProvider.verifyWebhookSignature only "verifies" an exact shared-secret match', () => {
  assert.equal(testProvider.verifyWebhookSignature({ headers: { 'x-test-signature': 'abc' }, rawBody: '{}' }, 'abc'), true);
  assert.equal(testProvider.verifyWebhookSignature({ headers: { 'x-test-signature': 'wrong' }, rawBody: '{}' }, 'abc'), false);
  assert.equal(testProvider.verifyWebhookSignature({ headers: {}, rawBody: '{}' }, 'abc'), false);
});

test('testProvider.parseWebhookEvent normalizes the payload into the PaymentEvent shape', () => {
  const event = testProvider.parseWebhookEvent({ headers: {}, rawBody: JSON.stringify({ type: 'payment.succeeded', reference: 'ref-1', amountCents: 500 }) });
  assert.equal(event.provider, 'test');
  assert.equal(event.type, 'payment.succeeded');
  assert.equal(event.reference, 'ref-1');
  assert.equal(event.amountCents, 500);
  assert.ok(event.providerEventId);
});

test('testProvider.refund returns a fake refund reference, never calls a real network', async () => {
  const refund = await testProvider.refund('test_session_abc', 1000);
  assert.match(refund.refundReference, /^test_refund_/);
  assert.equal(refund.amountCents, 1000);
});

test('stripeProvider and paypalProvider are not configured — every method throws ProviderNotConfiguredError, never silently succeeds', async () => {
  for (const provider of [stripeProvider, paypalProvider]) {
    await assert.rejects(() => provider.createSession({}), ProviderNotConfiguredError);
    assert.throws(() => provider.verifyWebhookSignature({}, 'secret'), ProviderNotConfiguredError);
    assert.throws(() => provider.parseWebhookEvent({}), ProviderNotConfiguredError);
    await assert.rejects(() => provider.getTransaction('ref'), ProviderNotConfiguredError);
    await assert.rejects(() => provider.refund('ref'), ProviderNotConfiguredError);
  }
});

test('stripeProvider and paypalProvider are independent — neither routes through the other', () => {
  assert.notEqual(stripeProvider, paypalProvider);
  assert.equal(stripeProvider.name, 'stripe');
  assert.equal(paypalProvider.name, 'paypal');
});
