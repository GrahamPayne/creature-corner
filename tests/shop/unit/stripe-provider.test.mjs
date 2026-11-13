import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripeProvider } from '../../../src/features/shop/payments/providers/stripeProvider.js';
import { implementsPaymentProviderContract } from '../../../src/features/shop/payments/paymentProvider.js';

/** Builds a real, validly-signed Stripe-style webhook header the same way Stripe itself does — genuine HMAC-SHA256, not a stub. */
async function signStripePayload(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const hex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

test('stripeProvider implements the full PaymentProvider contract', () => {
  assert.equal(implementsPaymentProviderContract(stripeProvider), true);
});

test('verifyWebhookSignature accepts a genuinely valid signature', async () => {
  const secret = 'whsec_test_secret';
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const header = await signStripePayload(secret, rawBody);
  assert.equal(await stripeProvider.verifyWebhookSignature(rawBody, header, secret), true);
});

test('verifyWebhookSignature rejects a signature computed with the wrong secret', async () => {
  const rawBody = JSON.stringify({ id: 'evt_1' });
  const header = await signStripePayload('wrong_secret', rawBody);
  assert.equal(await stripeProvider.verifyWebhookSignature(rawBody, header, 'whsec_test_secret'), false);
});

test('verifyWebhookSignature rejects a tampered body (classic payload-substitution attack)', async () => {
  const secret = 'whsec_test_secret';
  const originalBody = JSON.stringify({ id: 'evt_1', amount: 100 });
  const header = await signStripePayload(secret, originalBody);
  const tamperedBody = JSON.stringify({ id: 'evt_1', amount: 100000 });
  assert.equal(await stripeProvider.verifyWebhookSignature(tamperedBody, header, secret), false);
});

test('verifyWebhookSignature rejects a stale timestamp (replay protection)', async () => {
  const secret = 'whsec_test_secret';
  const rawBody = JSON.stringify({ id: 'evt_1' });
  const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
  const header = await signStripePayload(secret, rawBody, tenMinutesAgo);
  assert.equal(await stripeProvider.verifyWebhookSignature(rawBody, header, secret), false);
});

test('verifyWebhookSignature rejects malformed/missing headers', async () => {
  assert.equal(await stripeProvider.verifyWebhookSignature('{}', '', 'secret'), false);
  assert.equal(await stripeProvider.verifyWebhookSignature('{}', 'not-a-valid-header', 'secret'), false);
  assert.equal(await stripeProvider.verifyWebhookSignature('{}', 't=123', 'secret'), false);
});

test('parseWebhookEvent normalizes a checkout.session.completed event', () => {
  const raw = JSON.stringify({
    id: 'evt_123',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_abc', amount_total: 2500 } },
  });
  const event = stripeProvider.parseWebhookEvent(raw);
  assert.equal(event.provider, 'stripe');
  assert.equal(event.providerEventId, 'evt_123');
  assert.equal(event.type, 'checkout.session.completed');
  assert.equal(event.reference, 'cs_test_abc');
  assert.equal(event.amountCents, 2500);
});

test('createSession refuses a non-sandbox key unless STRIPE_MODE is explicitly "live"', async () => {
  const order = { id: 'o1', orderNumber: 'CC-1', totalCents: 100, shippingCents: 0, taxCents: 0, currency: 'usd', email: 'a@b.com', items: [], successUrl: 'https://x/success', cancelUrl: 'https://x/cancel' };
  await assert.rejects(() => stripeProvider.createSession(order, { STRIPE_SECRET_KEY: 'sk_live_whoops' }), /Sandbox|not a recognized/);
});

test('createSession throws ProviderNotConfiguredError when no secret key is set', async () => {
  const order = { id: 'o1', orderNumber: 'CC-1', totalCents: 100, shippingCents: 0, taxCents: 0, currency: 'usd', email: 'a@b.com', items: [], successUrl: 'x', cancelUrl: 'x' };
  await assert.rejects(() => stripeProvider.createSession(order, {}));
});

test('createSession sends the correct line items, totals, and metadata to Stripe (fetch mocked, no real network)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedBody = init.body;
    return {
      ok: true,
      json: async () => ({ id: 'cs_test_xyz', url: 'https://checkout.stripe.com/pay/cs_test_xyz', client_secret: null }),
    };
  };
  try {
    const order = {
      id: 'order-1',
      orderNumber: 'CC-20261113-0002',
      totalCents: 3300,
      shippingCents: 800,
      taxCents: 0,
      currency: 'usd',
      email: 'customer@example.com',
      items: [{ name: 'Creature Lighter-001', unitPriceCents: 2500, quantity: 1, imageUrl: 'https://example.com/img.webp' }],
      successUrl: 'https://creaturecorner.art/order-confirmation?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://creaturecorner.art/cart?checkout=cancelled',
    };
    const session = await stripeProvider.createSession(order, { STRIPE_SECRET_KEY: 'sk_test_abc' });

    assert.equal(session.provider, 'stripe');
    assert.equal(session.reference, 'cs_test_xyz');
    assert.equal(session.redirectUrl, 'https://checkout.stripe.com/pay/cs_test_xyz');

    const params = new URLSearchParams(capturedBody);
    assert.equal(params.get('mode'), 'payment');
    assert.equal(params.get('customer_email'), 'customer@example.com');
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '2500');
    assert.equal(params.get('line_items[0][quantity]'), '1');
    assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'Creature Lighter-001');
    // Shipping is its own line item, not silently dropped.
    assert.equal(params.get('line_items[1][price_data][unit_amount]'), '800');
    assert.equal(params.get('metadata[order_id]'), 'order-1');
    // Tax automation must default OFF — flipping it on is an explicit env var.
    assert.equal(params.get('automatic_tax[enabled]'), 'false');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSession enables automatic_tax only when explicitly configured via env', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedBody = init.body;
    return { ok: true, json: async () => ({ id: 'cs_test_xyz', url: 'https://x' }) };
  };
  try {
    const order = { id: 'o1', orderNumber: 'CC-1', totalCents: 100, shippingCents: 0, taxCents: 0, currency: 'usd', email: 'a@b.com', items: [], successUrl: 'x', cancelUrl: 'x' };
    await stripeProvider.createSession(order, { STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_AUTOMATIC_TAX: 'true' });
    const params = new URLSearchParams(capturedBody);
    assert.equal(params.get('automatic_tax[enabled]'), 'true');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSession surfaces a Stripe API error instead of pretending success', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: { message: 'Invalid API key.' } }) });
  try {
    const order = { id: 'o1', orderNumber: 'CC-1', totalCents: 100, shippingCents: 0, taxCents: 0, currency: 'usd', email: 'a@b.com', items: [], successUrl: 'x', cancelUrl: 'x' };
    await assert.rejects(() => stripeProvider.createSession(order, { STRIPE_SECRET_KEY: 'sk_test_abc' }), /Invalid API key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
