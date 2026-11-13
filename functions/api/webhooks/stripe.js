/**
 * Stripe webhook endpoint. This is the ONLY path that can ever mark a real
 * order Paid — never a browser redirect, never an admin action (see
 * admin/ordersApi.js's adminConfirmTestPayment, which explicitly refuses
 * non-test orders). Signature-verified, idempotent, and durable: every
 * verified event is recorded in payment_events before any processing is
 * attempted, so a processing bug can never silently lose a paid order
 * (section E) — the raw event is still there to reprocess/investigate.
 *
 * Required Cloudflare Pages secrets:
 *   SUPABASE_SERVICE_ROLE_KEY, STRIPE_WEBHOOK_SECRET
 *
 * Webhook URL to register in the Stripe Dashboard (derived from this
 * route, not invented): https://creaturecorner.art/api/webhooks/stripe
 */
import { SUPABASE_URL } from '../../../src/features/shop/api/config.js';
import { getPaymentProvider } from '../../../src/features/shop/payments/providerRegistry.js';

function createSupabaseRest(url, serviceRoleKey) {
  const base = `${url}/rest/v1`;
  const authHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

  async function request(path, init = {}) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...authHeaders, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const error = Array.isArray(body) ? body[0] : body;
      return { data: null, error: error || { message: `HTTP ${res.status}`, code: String(res.status) }, count: null };
    }
    return { data: body, error: null };
  }

  return {
    async select(table, select, filters = {}) {
      const params = new URLSearchParams({ select });
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`);
    },
    async insertOne(table, row) {
      const { data, error } = await request(`/${table}`, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
      return { data: Array.isArray(data) ? data[0] : data, error };
    },
    async update(table, patch, filters) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`, { method: 'PATCH', body: JSON.stringify(patch) });
    },
    async rpc(fn, args) {
      return request(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    },
  };
}

async function getOrder(db, orderId) {
  const { data } = await db.select('orders', 'id,payment_status,fulfillment_status', { id: `eq.${orderId}` });
  return data?.[0] || null;
}

/**
 * Confirms every reservation tied to this order. confirm_reservation() is a
 * silent no-op on a reservation that's already 'expired'/'released' (by
 * design, so a duplicate webhook delivery can't double-confirm) — which
 * means a reservation that was swept away by the 30-minute TTL (or
 * released by a checkout.session.expired event that then raced against a
 * late-arriving async payment success) would otherwise let this function
 * report success while silently never decrementing inventory for a paid
 * order. To avoid that, any reservation not currently 'reserved' or already
 * 'confirmed' gets a fresh reserve_inventory() attempt for the same
 * product/quantity before confirming it — recovering the normal case where
 * stock is still available, and surfacing a genuine conflict (stock sold to
 * someone else in the interim) via the returned `conflicts` list instead of
 * swallowing it.
 */
async function confirmOrderReservations(db, orderId) {
  const { data: reservations, error } = await db.select('inventory_reservations', 'id,product_id,quantity,status', { order_id: `eq.${orderId}` });
  if (error) throw new Error(`Could not load reservations: ${error.message}`);

  const conflicts = [];
  for (const r of reservations) {
    if (r.status === 'confirmed') continue;

    let reservationId = r.id;
    if (r.status !== 'reserved') {
      const { data: fresh, error: reserveError } = await db.rpc('reserve_inventory', { p_product_id: r.product_id, p_quantity: r.quantity, p_order_id: orderId, p_ttl_minutes: 30 });
      if (reserveError || !fresh?.id) {
        conflicts.push({ productId: r.product_id, quantity: r.quantity, reason: reserveError?.message || 'reservation unavailable' });
        continue;
      }
      reservationId = fresh.id;
    }

    const { error: confirmError } = await db.rpc('confirm_reservation', { p_reservation_id: reservationId });
    if (confirmError) conflicts.push({ productId: r.product_id, quantity: r.quantity, reason: confirmError.message });
  }
  return conflicts;
}

async function releaseOrderReservations(db, orderId) {
  const { data: reservations, error } = await db.select('inventory_reservations', 'id', { order_id: `eq.${orderId}`, status: 'eq.reserved' });
  if (error) throw new Error(`Could not load reservations: ${error.message}`);
  for (const r of reservations) {
    const { error: rpcError } = await db.rpc('release_reservation', { p_reservation_id: r.id });
    if (rpcError) throw new Error(`Could not release reservation ${r.id}: ${rpcError.message}`);
  }
}

/** checkout.session.completed / async_payment_succeeded — the only path that marks a real order Paid. */
async function handlePaymentSucceeded(db, sessionObject) {
  const orderId = sessionObject.metadata?.order_id;
  if (!orderId) return 'no order_id in metadata, nothing to do';

  const order = await getOrder(db, orderId);
  if (!order) return `order ${orderId} not found`;
  // Idempotent across different event types racing/retrying for the same
  // session (e.g. both completed and async_payment_succeeded firing) —
  // payment_events' unique constraint already stops the SAME event from
  // reprocessing; this stops a DIFFERENT event for the same order from
  // double-confirming.
  if (order.payment_status === 'paid') return 'already paid, no-op';

  const conflicts = await confirmOrderReservations(db, orderId);

  // Payment status reflects what Stripe actually did with the customer's
  // money — that's true regardless of inventory outcome, and must never be
  // hidden or delayed behind a reconciliation step. If one or more items
  // couldn't be confirmed (stock genuinely no longer available), that's
  // recorded as a distinct, admin-visible event rather than silently
  // dropped — never losing the fact that a paid order needs manual review.
  const patch = {
    payment_status: 'paid',
    paid_at: new Date().toISOString(),
    status: 'paid',
  };
  if (sessionObject.payment_intent) patch.stripe_payment_intent_id = sessionObject.payment_intent;
  await db.update('orders', patch, { id: `eq.${orderId}` });

  if (conflicts.length > 0) {
    console.error('Stripe payment succeeded but inventory could not be confirmed for order', orderId, conflicts);
    await db.insertOne('order_events', { order_id: orderId, event_type: 'payment.inventory_conflict', payload: { sessionId: sessionObject.id, conflicts }, created_by: 'stripe-webhook' });
    return 'paid with inventory conflict — needs manual review';
  }

  await db.insertOne('order_events', { order_id: orderId, event_type: 'payment.paid', payload: { sessionId: sessionObject.id, paymentIntent: sessionObject.payment_intent }, created_by: 'stripe-webhook' });
  return 'paid';
}

/** checkout.session.expired — releases reservations, never touches an already-paid order. */
async function handleCheckoutExpired(db, sessionObject) {
  const orderId = sessionObject.metadata?.order_id;
  if (!orderId) return 'no order_id in metadata';
  const order = await getOrder(db, orderId);
  if (!order || order.payment_status !== 'pending') return 'not pending, no-op';

  await releaseOrderReservations(db, orderId);
  await db.update('orders', { payment_status: 'cancelled', cancelled_at: new Date().toISOString(), status: 'cancelled' }, { id: `eq.${orderId}` });
  await db.insertOne('order_events', { order_id: orderId, event_type: 'checkout.expired', payload: { sessionId: sessionObject.id }, created_by: 'stripe-webhook' });
  return 'expired, reservations released';
}

/** checkout.session.async_payment_failed / payment_intent.payment_failed — releases reservations, marks failed. */
async function handlePaymentFailed(db, object) {
  const orderId = object.metadata?.order_id;
  if (!orderId) return 'no order_id in metadata';
  const order = await getOrder(db, orderId);
  if (!order || order.payment_status !== 'pending') return 'not pending, no-op';

  await releaseOrderReservations(db, orderId);
  await db.update('orders', { payment_status: 'failed' }, { id: `eq.${orderId}` });
  await db.insertOne('order_events', { order_id: orderId, event_type: 'payment.failed', payload: { reference: object.id }, created_by: 'stripe-webhook' });
  return 'failed, reservations released';
}

/**
 * charge.refunded — reconciles a refund issued directly in the Stripe
 * Dashboard (not through Admin -> Orders). Stripe's `charge.amount_refunded`
 * is already cumulative across any number of partial refunds, so this
 * never needs to accumulate manually. Deliberately does NOT touch
 * inventory or reservations — a refund must never automatically make a
 * one-of-a-kind piece available again (section E); that stays an explicit
 * admin decision via the product editor.
 */
async function handleChargeRefunded(db, charge) {
  const orderId = charge.metadata?.order_id;
  let order = null;
  if (orderId) order = await getOrder(db, orderId);
  if (!order && charge.payment_intent) {
    const { data } = await db.select('orders', 'id,payment_status', { stripe_payment_intent_id: `eq.${charge.payment_intent}` });
    order = data?.[0] || null;
  }
  if (!order) return 'no matching order found for this charge';

  const isFullRefund = charge.refunded === true;
  const patch = { payment_status: isFullRefund ? 'refunded' : 'partially_refunded', refunded_amount_cents: charge.amount_refunded };
  if (isFullRefund) {
    patch.refunded_at = new Date().toISOString();
    patch.status = 'refunded';
  }
  await db.update('orders', patch, { id: `eq.${order.id}` });
  await db.insertOne('order_events', { order_id: order.id, event_type: 'payment.refunded', payload: { chargeId: charge.id, amountRefundedCents: charge.amount_refunded, fullRefund: isFullRefund }, created_by: 'stripe-webhook' });
  return isFullRefund ? 'fully refunded' : 'partially refunded';
}

async function processEvent(db, event) {
  const object = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handlePaymentSucceeded(db, object);
    case 'checkout.session.expired':
      return handleCheckoutExpired(db, object);
    case 'checkout.session.async_payment_failed':
    case 'payment_intent.payment_failed':
      return handlePaymentFailed(db, object);
    case 'charge.refunded':
      return handleChargeRefunded(db, object);
    default:
      return `unhandled event type ${event.type}, acknowledged without action`;
  }
}

/** @param {{request: Request, env: Record<string,string>}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook not configured', { status: 503 });
  }

  // Raw text, not request.json() — Stripe's signature covers the exact
  // byte sequence it sent; re-serializing a parsed object would never
  // match (see stripeProvider.js's verifyWebhookSignature doc comment).
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('stripe-signature') || '';

  const provider = getPaymentProvider('stripe');
  const valid = await provider.verifyWebhookSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Malformed event body', { status: 400 });
  }
  if (!event.id || !event.type) {
    return new Response('Malformed event', { status: 400 });
  }

  const db = createSupabaseRest(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Idempotency: the unique(provider, provider_event_id) constraint is the
  // actual guarantee — a duplicate delivery's insert fails here (23505),
  // which is treated as already-processed, never reprocessed and never an
  // error back to Stripe (Stripe would just retry a non-2xx indefinitely).
  const { error: insertError } = await db.insertOne('payment_events', {
    provider: 'stripe',
    provider_event_id: event.id,
    order_id: event.data?.object?.metadata?.order_id || null,
    event_type: event.type,
    payload: event,
    processed_at: new Date().toISOString(),
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return new Response('Already processed', { status: 200 });
    }
    console.error('Could not record Stripe webhook event', event.id, insertError);
    return new Response('Could not record event', { status: 500 });
  }

  try {
    const result = await processEvent(db, event);
    return new Response(result || 'ok', { status: 200 });
  } catch (err) {
    // The event is already durably recorded in payment_events above, so
    // nothing is silently lost even though processing failed — it can be
    // reprocessed from that record. Still ack 200: a non-2xx just makes
    // Stripe retry an event already durably on file, which doesn't help.
    console.error('Stripe webhook processing failed', event.id, event.type, err);
    return new Response('Recorded; processing error — see function logs', { status: 200 });
  }
}
