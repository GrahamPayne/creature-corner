/**
 * Admin order-management service — the real, persistent backend for
 * Admin -> Orders. Every function here performs an actual Supabase
 * operation (RLS-gated on is_admin(), same pattern every other
 * admin/api.js function already uses), not a UI mockup.
 *
 * What's deliberately NOT here: creating a REAL (non-test) paid order.
 * That only ever happens from a verified payment-provider webhook or
 * session confirmation, server-side, with a service-role key this admin
 * client doesn't have and shouldn't — see payments/paymentProvider.js and
 * functions/api/orders/create.js. adminCreateTestOrder() below is for
 * Safe Test Mode only (always payment_provider: 'test', test_mode: true),
 * reachable only from an authenticated admin session, never the public
 * checkout page.
 */
import { client, adminGetOrder, adminGetProduct, ORDER_SELECT, normalizeOrder } from './api.js';
import { pickPrimaryImage } from '../primaryImage.js';
import { computeOrderTotals } from '../order/orderTotals.js';
import { formatOrderNumber, parseOrderNumber } from '../order/orderNumber.js';
import {
  canTransitionPayment,
  canTransitionFulfillment,
  canTransitionShipping,
  canMarkFulfilled,
  canCancelOrder,
  canRefundOrder,
} from '../order/orderStates.js';
import { testProvider } from '../payments/providers/testProvider.js';
import { ProviderNotConfiguredError } from '../payments/paymentProvider.js';
import { noopNotificationProvider } from '../notifications/noopNotificationProvider.js';

/** Non-blocking: a notification failure must never fail the order action that triggered it. */
async function notifyBestEffort(type, order, recipient) {
  if (!recipient) return;
  try {
    await noopNotificationProvider.notify({ type, order, recipient });
  } catch (err) {
    console.error(`Notification "${type}" failed for order ${order.id}`, err);
  }
}

async function insertOrderEvent(supabase, orderId, eventType, payload, createdBy = 'admin') {
  const { error } = await supabase.from('order_events').insert({ order_id: orderId, event_type: eventType, payload, created_by: createdBy });
  if (error) throw error;
}

/** Retries with an incrementing sequence on a unique-constraint collision — same pattern batchUpload.js already uses for slug conflicts. */
async function generateUniqueOrderNumber(supabase) {
  const now = new Date();
  const base = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const prefix = formatOrderNumber({ ...base, sequence: 0 }).replace(/-0000$/, '-');

  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .like('order_number', `${prefix}%`);
  if (error) throw error;

  return formatOrderNumber({ ...base, sequence: (count || 0) + 1 });
}

/** @param {any} err @returns {boolean} */
function isDuplicateOrderNumberError(err) {
  if (err?.code !== '23505') return false;
  return String(err.message || '').includes('order_number') || String(err.details || '').includes('order_number');
}

/**
 * Safe Test Mode order creation (section J). Reserves inventory
 * atomically per line item via reserve_inventory() — a quantity-1 piece
 * already reserved by a concurrent test (or future real) checkout cannot
 * be double-booked. Starts at payment_status: 'pending' — creating the
 * order never marks it paid; adminConfirmTestPayment() is a separate,
 * explicit action, exactly like a real provider's webhook would be.
 *
 * @param {{
 *   items: {productId: string, quantity: number}[],
 *   customerName: string,
 *   email: string,
 *   fulfillmentType: 'shipping'|'pickup',
 *   shippingAddress?: any,
 *   notes?: string,
 * }} input
 */
export async function adminCreateTestOrder({ items, customerName, email, fulfillmentType, shippingAddress, notes }) {
  if (!items || items.length === 0) throw new Error('A test order needs at least one item.');
  const supabase = await client();

  const products = await Promise.all(items.map((i) => adminGetProduct(i.productId)));
  const orderItemsPayload = items.map((i, idx) => {
    const product = products[idx];
    const image = pickPrimaryImage(product.images);
    return {
      product_id: product.id,
      product_name: product.name,
      product_slug: product.slug,
      product_image_url: image?.url ?? null,
      unit_price_cents: product.priceCents,
      quantity: i.quantity,
    };
  });

  const totals = computeOrderTotals({
    items: orderItemsPayload.map((i) => ({ priceCents: i.unit_price_cents, quantity: i.quantity })),
    shippingCents: 0,
  });

  let orderNumber = await generateUniqueOrderNumber(supabase);
  let order;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        email,
        customer_name: customerName,
        fulfillment_type: fulfillmentType,
        shipping_address: fulfillmentType === 'shipping' ? shippingAddress : null,
        currency: 'usd',
        subtotal_cents: totals.subtotalCents,
        shipping_cents: totals.shippingCents,
        tax_cents: totals.taxCents,
        discount_cents: totals.discountCents,
        total_cents: totals.totalCents,
        payment_provider: 'test',
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        shipping_status: 'label_not_purchased',
        test_mode: true,
        notes: notes || null,
        status: 'pending', // legacy column kept in sync for any old reader
      })
      .select(ORDER_SELECT)
      .single();

    if (!error) {
      order = data;
      break;
    }
    if (isDuplicateOrderNumberError(error) && attempt < 9) {
      const parsed = parseOrderNumber(orderNumber);
      orderNumber = formatOrderNumber({ ...parsed, sequence: parsed.sequence + 1 });
      continue;
    }
    throw error;
  }

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItemsPayload.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) throw itemsError;

  // Reserve inventory per line item — atomic per product via the DB
  // function's row lock (see supabase/migrations/005_orders_fulfillment.sql).
  // If any item can't be reserved (e.g. the last unit just got taken by
  // another order), the order row already exists — leave it as an
  // unfulfillable pending/unreserved order rather than silently rolling
  // back, and surface the specific failure to the admin.
  const reservationFailures = [];
  for (const i of items) {
    try {
      await supabase.rpc('reserve_inventory', { p_product_id: i.productId, p_quantity: i.quantity, p_order_id: order.id, p_ttl_minutes: 15 });
    } catch (err) {
      reservationFailures.push({ productId: i.productId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await insertOrderEvent(supabase, order.id, 'order.created', { testMode: true, reservationFailures });

  const full = await adminGetOrder(order.id);
  if (reservationFailures.length > 0) {
    const err = /** @type {Error & {order: any}} */ (new Error(`Order ${full.orderNumber} was created, but inventory could not be reserved for ${reservationFailures.length} item(s): ${reservationFailures.map((f) => f.error).join('; ')}`));
    err.order = full;
    throw err;
  }
  return full;
}

/**
 * Explicit admin action simulating a verified payment — never an
 * automatic side effect of creating the order. Only works for test_mode
 * orders; a real order's payment_status can only ever become 'paid'
 * through a verified provider webhook (not built yet — see
 * payments/providers/stripeProvider.js's handoff checklist), never by an
 * admin clicking a button, which is exactly what Payment Security forbids.
 * @param {string} orderId
 */
export async function adminConfirmTestPayment(orderId) {
  const order = await adminGetOrder(orderId);
  if (!order.testMode) {
    throw new ProviderNotConfiguredError(order.paymentProvider || 'this provider');
  }
  if (!canTransitionPayment(order.paymentStatus, 'paid')) {
    throw new Error(`Cannot mark payment status "${order.paymentStatus}" as paid.`);
  }

  const supabase = await client();
  const { data: reservations, error: resError } = await supabase
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .eq('status', 'reserved');
  if (resError) throw resError;

  // adminCreateTestOrder can leave an order with fewer reservations than
  // line items (a reservation that failed at creation time — see its own
  // reservationFailures handling). Never mark payment as paid while that's
  // still true: that would make a "paid" order whose inventory was never
  // actually reserved/confirmed for every item it claims to contain.
  if (reservations.length < order.items.length) {
    throw new Error(
      `Cannot confirm payment — inventory was only reserved for ${reservations.length} of ${order.items.length} item(s). Check this order's history for the reservation failure, then cancel or retry it.`
    );
  }

  for (const r of reservations) {
    const { error } = await supabase.rpc('confirm_reservation', { p_reservation_id: r.id });
    if (error) throw error;
  }

  const session = await testProvider.createSession({ id: order.id, totalCents: order.totalCents, currency: order.currency, email: order.email });
  const { error } = await supabase
    .from('orders')
    .update({ payment_status: 'paid', payment_reference: session.reference, paid_at: new Date().toISOString(), status: 'paid' })
    .eq('id', orderId);
  if (error) throw error;

  await insertOrderEvent(supabase, orderId, 'payment.paid', { testMode: true, reference: session.reference });
  await notifyBestEffort('order.paid', order, order.email);
  return adminGetOrder(orderId);
}

/**
 * @param {string} orderId
 * @param {'unfulfilled'|'preparing'|'fulfilled'|'cancelled'} status
 */
export async function adminUpdateFulfillmentStatus(orderId, status) {
  const order = await adminGetOrder(orderId);
  if (!canTransitionFulfillment(order.fulfillmentStatus, status)) {
    throw new Error(`Cannot move fulfillment status from "${order.fulfillmentStatus}" to "${status}".`);
  }
  if (status === 'fulfilled' && !canMarkFulfilled(order)) {
    throw new Error('Cannot mark fulfilled — this order has not been paid yet.');
  }

  const supabase = await client();
  const patch = { fulfillment_status: status };
  if (status === 'fulfilled') patch.fulfilled_at = new Date().toISOString();
  if (order.fulfillmentStatus === 'fulfilled' && status !== 'fulfilled') patch.fulfilled_at = null;
  // Legacy `status` column: only follow fulfillment here when payment is
  // already settled, so it never regresses from e.g. 'paid' to 'fulfilled'
  // for a status value nothing else still reads differently, nor implies
  // payment where none occurred.
  if (status === 'fulfilled' && order.paymentStatus === 'paid') patch.status = 'fulfilled';

  const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
  if (error) throw error;

  await insertOrderEvent(supabase, orderId, 'fulfillment.updated', { from: order.fulfillmentStatus, to: status });
  if (status === 'fulfilled') await notifyBestEffort('order.shipped', order, order.email);
  return adminGetOrder(orderId);
}

/** @param {string} orderId @param {'label_not_purchased'|'label_created'|'shipped'|'in_transit'|'delivered'|'exception'} status */
export async function adminUpdateShippingStatus(orderId, status) {
  const order = await adminGetOrder(orderId);
  if (!canTransitionShipping(order.shippingStatus, status)) {
    throw new Error(`Cannot move shipping status from "${order.shippingStatus}" to "${status}".`);
  }

  const supabase = await client();
  const { error } = await supabase.from('orders').update({ shipping_status: status }).eq('id', orderId);
  if (error) throw error;

  await insertOrderEvent(supabase, orderId, 'shipping.updated', { from: order.shippingStatus, to: status });
  return adminGetOrder(orderId);
}

/**
 * Manual tracking entry (section H) — no label provider is called, this
 * just records what the admin typed.
 * @param {string} orderId
 * @param {{carrier?: string, service?: string, trackingNumber?: string}} info
 */
export async function adminUpdateTrackingInfo(orderId, { carrier, service, trackingNumber }) {
  const supabase = await client();
  const { error } = await supabase
    .from('orders')
    .update({ shipping_carrier: carrier || null, shipping_service: service || null, tracking_number: trackingNumber || null })
    .eq('id', orderId);
  if (error) throw error;

  await insertOrderEvent(supabase, orderId, 'tracking.updated', { carrier, service, trackingNumber });
  const order = await adminGetOrder(orderId);
  if (trackingNumber) await notifyBestEffort('order.tracking_added', order, order.email);
  return order;
}

/** @param {string} orderId @param {string} notes */
export async function adminUpdateOrderNotes(orderId, notes) {
  const supabase = await client();
  const { error } = await supabase.from('orders').update({ notes: notes || null }).eq('id', orderId);
  if (error) throw error;
  return adminGetOrder(orderId);
}

/**
 * Cancels an eligible order (section F: "Cancel an eligible order"). A
 * fulfilled order can't be cancelled this way — it already shipped;
 * that's a refund, not a cancellation. Releases any still-reserved (not
 * yet payment-confirmed) inventory back to availability.
 * @param {string} orderId @param {string} [reason]
 */
export async function adminCancelOrder(orderId, reason) {
  const order = await adminGetOrder(orderId);
  if (!canCancelOrder(order)) {
    throw new Error(`Cannot cancel an order with payment status "${order.paymentStatus}".`);
  }
  if (order.fulfillmentStatus === 'fulfilled') {
    throw new Error('This order has already been fulfilled — cancel is not available; use a refund instead.');
  }

  const supabase = await client();
  const { data: reservations, error: resError } = await supabase
    .from('inventory_reservations')
    .select('id')
    .eq('order_id', orderId)
    .eq('status', 'reserved');
  if (resError) throw resError;
  for (const r of reservations) {
    const { error } = await supabase.rpc('release_reservation', { p_reservation_id: r.id });
    if (error) throw error;
  }

  const patch = { fulfillment_status: 'cancelled', cancelled_at: new Date().toISOString() };
  // Only an unpaid order's payment itself is "cancelled" here — a paid
  // order keeps payment_status: 'paid' (the money was real) and needs a
  // separate refund action, not a silent payment-status change.
  if (order.paymentStatus === 'pending') {
    patch.payment_status = 'cancelled';
    patch.status = 'cancelled';
  }

  const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
  if (error) throw error;

  await insertOrderEvent(supabase, orderId, 'order.cancelled', { reason: reason || null });
  await notifyBestEffort('order.cancelled', order, order.email);
  return adminGetOrder(orderId);
}

/**
 * Test-mode-only refund (section C/J). A real order's refund must go
 * through the actual payment provider's refund API — no such provider is
 * connected yet, so this intentionally refuses rather than faking success
 * (same "never a fake payment success callback" rule applied to refunds).
 * @param {string} orderId @param {{amountCents?: number, reason?: string}} [opts]
 */
export async function adminRefundOrder(orderId, { amountCents, reason } = {}) {
  const order = await adminGetOrder(orderId);
  if (!order.testMode) {
    throw new ProviderNotConfiguredError(order.paymentProvider || 'this provider');
  }
  if (!canRefundOrder(order)) {
    throw new Error(`Cannot refund an order with payment status "${order.paymentStatus}".`);
  }

  // Validated against what's actually still refundable (total minus every
  // prior refund on this order), not just the original total — otherwise
  // repeated partial refunds could together exceed the order total.
  const alreadyRefunded = order.refundedAmountCents || 0;
  const remaining = order.totalCents - alreadyRefunded;
  const amountToRefund = typeof amountCents === 'number' ? amountCents : remaining;
  if (amountToRefund <= 0 || amountToRefund > remaining) {
    throw new Error(`Cannot refund ${amountToRefund} cents — only ${remaining} cents remain refundable on this order.`);
  }

  const refund = await testProvider.refund(order.paymentReference, amountToRefund);
  const newRefundedTotal = alreadyRefunded + amountToRefund;
  const isFull = newRefundedTotal >= order.totalCents;
  const nextStatus = isFull ? 'refunded' : 'partially_refunded';
  if (!canTransitionPayment(order.paymentStatus, nextStatus)) {
    throw new Error(`Cannot move payment status from "${order.paymentStatus}" to "${nextStatus}".`);
  }

  const supabase = await client();
  const patch = { payment_status: nextStatus, refunded_amount_cents: newRefundedTotal };
  if (isFull) {
    patch.refunded_at = new Date().toISOString();
    patch.status = 'refunded';
  }
  const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
  if (error) throw error;

  await insertOrderEvent(supabase, orderId, 'payment.refunded', { reference: refund.refundReference, amountCents: refund.amountCents, reason: reason || null });
  await notifyBestEffort('order.refunded', order, order.email);
  return adminGetOrder(orderId);
}

/** @param {string} orderId @returns {Promise<{id:string, eventType:string, payload:any, createdBy:string, createdAt:string}[]>} */
export async function adminListOrderEvents(orderId) {
  const supabase = await client();
  const { data, error } = await supabase
    .from('order_events')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => ({ id: row.id, eventType: row.event_type, payload: row.payload, createdBy: row.created_by, createdAt: row.created_at }));
}
