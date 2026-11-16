import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../../../functions/api/webhooks/stripe.js';

const env = { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', STRIPE_WEBHOOK_SECRET: 'test-webhook-secret' };
const event = { id: 'evt_test', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_test' } } };
function request(payload = event, secret = env.STRIPE_WEBHOOK_SECRET) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://example.invalid/api/webhooks/stripe', { method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } });
}

test('verified delivery uses exactly one atomic RPC with the original event', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return Response.json({ result: 'paid' });
  });
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'paid');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/process_stripe_event$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_event: event });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
});

test('database failures remain retryable, including a unique violation outside the event claim', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const code of ['23505', '40001', '40P01', 'P0001']) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ code, message: 'private details' }, { status: 500 }));
    const response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private details/);
    fetchMock.mock.restore();
  }
});

test('network failure and invalid RPC response return 500', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const handler of [async () => { throw new Error('network'); }, async () => new Response('invalid'), async () => Response.json(null)]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', handler);
    assert.equal((await onRequestPost({ request: request(), env })).status, 500);
    fetchMock.mock.restore();
  }
});

test('a retry after failure is sent to SQL again; only committed duplicates get 200', async (t) => {
  t.mock.method(console, 'error', () => {});
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => ++count === 1 ? new Response('', { status: 503 }) : Response.json({ result: 'already processed' }));
  assert.equal((await onRequestPost({ request: request(), env })).status, 500);
  assert.equal((await onRequestPost({ request: request(), env })).status, 200);
  assert.equal(count, 2);
});

test('invalid signature, malformed event, and mode mismatch never access SQL', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('unexpected database request'); });
  assert.equal((await onRequestPost({ request: request(event, 'wrong'), env })).status, 400);
  for (const payload of ['{', 'null', {}, { ...event, id: 42 }, { ...event, livemode: undefined }, { ...event, livemode: true }]) {
    assert.equal((await onRequestPost({ request: request(payload), env })).status, 400);
  }
  assert.equal((await onRequestPost({ request: request(), env: {} })).status, 503);
});

test('explicit live mode accepts a signed live event', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ result: 'paid' }));
  assert.equal((await onRequestPost({ request: request({ ...event, livemode: true }), env: { ...env, STRIPE_MODE: 'live' } })).status, 200);
});
