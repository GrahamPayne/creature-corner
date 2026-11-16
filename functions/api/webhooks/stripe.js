/** Verified Stripe events are applied by one service-role-only SQL transaction.
 * A failed transaction leaves no event marker; Stripe can safely retry it.
 */
import { SUPABASE_URL } from '../../../src/features/shop/api/config.js';
import { getPaymentProvider } from '../../../src/features/shop/payments/providerRegistry.js';

/** @param {{request: Request, env: Record<string,string>}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook not configured', { status: 503 });
  }
  const rawBody = await request.text();
  const provider = getPaymentProvider('stripe');
  if (!await provider.verifyWebhookSignature(rawBody, request.headers.get('stripe-signature') || '', env.STRIPE_WEBHOOK_SECRET)) {
    return new Response('Invalid signature', { status: 400 });
  }
  let event;
  try { event = JSON.parse(rawBody); } catch {
    return new Response('Malformed event body', { status: 400 });
  }
  if (!event || typeof event.id !== 'string' || !event.id || typeof event.type !== 'string' || !event.type || typeof event.livemode !== 'boolean') {
    return new Response('Malformed event', { status: 400 });
  }
  if (event.livemode !== (env.STRIPE_MODE === 'live')) {
    return new Response('Stripe mode mismatch', { status: 400 });
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_stripe_event`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_event: event }),
    });
    if (!response.ok) throw new Error('Webhook transaction failed');
    const result = await response.json();
    if (!result || typeof result.result !== 'string') throw new Error('Invalid transaction response');
    return new Response(result.result, { status: 200 });
  } catch {
    // Do not echo database errors, customer payloads, or credentials.
    console.error('Stripe webhook transaction failed', event.id, event.type);
    return new Response('Processing failed; retry required', { status: 500 });
  }
}
