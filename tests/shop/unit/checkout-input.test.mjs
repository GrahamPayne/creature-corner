import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../../../functions/api/orders/create.js';

const valid = {
  items: [{ productId: '684eb1f8-7dfd-4f20-999c-210a1097eb45', quantity: 1 }],
  email: 'test@example.invalid', customerName: 'Checkout test', fulfillmentType: 'pickup',
};

async function submit(input, extraEnv = {}) {
  return onRequestPost({
    request: new Request('https://example.invalid/api/orders/create', { method: 'POST', body: JSON.stringify(input) }),
    env: { SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ...extraEnv },
  });
}

test('invalid checkout requests are rejected before any database or Stripe call', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  for (const quantity of [0, -1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await submit({ ...valid, items: [{ ...valid.items[0], quantity }] })).status, 400);
  }
  assert.equal((await submit({ ...valid, items: [valid.items[0], valid.items[0]] })).status, 400);
  assert.equal((await submit({ ...valid, items: [null] })).status, 400);
  assert.equal((await submit({ ...valid, items: [{ productId: 'invalid),status.eq.available', quantity: 1 }] })).status, 400);
  assert.equal((await submit({ ...valid, email: 'invalid' })).status, 400);
  assert.equal((await submit({ ...valid, fulfillmentType: 'shipping' })).status, 400);
});

test('missing or mismatched payment configuration cannot create orphan orders', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  assert.equal((await submit(valid)).status, 503);
  assert.equal((await submit(valid, { STRIPE_SECRET_KEY: 'sk_live_fixture' })).status, 503);
  assert.equal((await submit(valid, { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_MODE: 'live' })).status, 503);
});

test('a failed products lookup (bad credentials, RLS, schema drift) returns a generic 500 and logs the real error server-side, never to the client', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Invalid API key' }, { status: 401 }));
  const res = await submit(valid, { STRIPE_SECRET_KEY: 'sk_test_fixture' });
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /Invalid API key/);
  assert.equal(console.error.mock.calls.length, 1);
  assert.match(console.error.mock.calls[0].arguments[0], /Could not load products/);
});

const PRODUCT_ROW = {
  id: valid.items[0].productId,
  name: 'TEST', slug: 'test', price_cents: 100, quantity: 3, status: 'available',
  shipping_class: 'medium', pickup_available: true, images: [],
};

/** A full, realistic Supabase+Stripe fetch mock for the happy path, keyed by URL/method. `overrides` can replace the products-select response. */
function mockFullCheckoutChain({ productsResponse } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/products')) {
      return productsResponse ?? Response.json([PRODUCT_ROW]);
    }
    if (u.includes('/rest/v1/shipping_classes')) return Response.json([{ key: 'medium', flat_price_cents: 800 }]);
    if (u.includes('/rest/v1/orders') && (!init.method || init.method === 'GET')) {
      return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
    }
    if (u.includes('/rest/v1/orders') && init.method === 'POST') {
      return Response.json([{ id: 'order-fixture-1', order_number: 'CC-FIXTURE-0001' }]);
    }
    if (u.includes('/rest/v1/order_items') && init.method === 'POST') return Response.json([]);
    if (u.includes('/rpc/reserve_inventory')) return Response.json({ id: 'reservation-fixture-1' });
    if (u.includes('/rest/v1/orders') && init.method === 'PATCH') return Response.json([{ id: 'order-fixture-1' }]);
    if (u.includes('api.stripe.com/v1/checkout/sessions')) {
      return Response.json({ id: 'cs_test_fixture', url: 'https://checkout.stripe.com/pay/cs_test_fixture' });
    }
    throw new Error(`Unexpected fetch in happy-path mock: ${u}`);
  };
}

test('a valid checkout re-prices from the database (ignoring any client-supplied price) and reaches a real Stripe Checkout session', async (t) => {
  t.mock.method(globalThis, 'fetch', mockFullCheckoutChain());
  // A client-supplied price field is not even part of the accepted request
  // shape — proving the server never reads one is implicit in totals being
  // computed purely from PRODUCT_ROW.price_cents (100) below, not from this.
  const res = await submit({ ...valid, items: [{ ...valid.items[0], price_cents: 1 }] }, { STRIPE_SECRET_KEY: 'sk_test_fixture' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.redirectUrl, 'https://checkout.stripe.com/pay/cs_test_fixture');
  assert.match(body.orderNumber, /^CC-\d{8}-0001$/);
});

test('requesting more than the available stock is rejected before any order is created', async (t) => {
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/orders') && init.method === 'POST') posts.push(u);
    if (u.includes('/rest/v1/products')) return Response.json([{ ...PRODUCT_ROW, quantity: 1 }]);
    throw new Error(`Unexpected fetch for an out-of-stock request: ${u}`);
  });
  const res = await submit({ ...valid, items: [{ ...valid.items[0], quantity: 2 }] }, { STRIPE_SECRET_KEY: 'sk_test_fixture' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Not enough stock/);
  assert.deepEqual(posts, []);
});

test('a sold-out or hidden product is rejected as no longer available, never leaking its real stock state', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/rest/v1/products')) return Response.json([{ ...PRODUCT_ROW, status: 'sold' }]);
    throw new Error('Unexpected fetch for a sold-out product');
  });
  const res = await submit(valid, { STRIPE_SECRET_KEY: 'sk_test_fixture' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no longer available/);
});
