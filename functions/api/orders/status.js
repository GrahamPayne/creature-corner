/**
 * Minimal, public-safe order-status lookup for the order-confirmation
 * page. Deliberately returns only what's needed to show a confirmation —
 * no email, no shipping address, no internal id, no other customer's
 * data (section H: "must not expose customer order information
 * publicly"). Looked up by Stripe Checkout Session id, which is itself an
 * unguessable, cryptographically random token Stripe generates — knowing
 * it is the same proof-of-identity Stripe's own success_url redirect
 * already relies on.
 *
 * The confirmation page calls this specifically so it never has to claim
 * "payment succeeded" just because Stripe redirected the browser here —
 * it reflects whatever the webhook has actually recorded (section H /
 * Payment Security). If the webhook hasn't landed yet, this correctly
 * reports "pending", not "paid".
 */
import { SUPABASE_URL } from '../../../src/features/shop/api/config.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** @param {{request: Request, env: Record<string,string>}} context */
export async function onRequestGet({ request, env }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Not configured yet.' }, 503);
  }

  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId) return jsonResponse({ error: 'Missing session_id.' }, 400);

  const select = 'order_number,payment_status,fulfillment_status,currency,total_cents,items:order_items(product_name,product_image_url,quantity,unit_price_cents)';
  const params = new URLSearchParams({ select, payment_reference: `eq.${sessionId}` });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?${params.toString()}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const rows = await res.json();
  if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: 'Order not found.' }, 404);
  }

  const order = rows[0];
  return jsonResponse({
    orderNumber: order.order_number,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    currency: order.currency,
    totalCents: order.total_cents,
    items: (order.items || []).map((i) => ({ name: i.product_name, imageUrl: i.product_image_url, quantity: i.quantity, unitPriceCents: i.unit_price_cents })),
  });
}
