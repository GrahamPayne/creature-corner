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
