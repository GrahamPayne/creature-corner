/**
 * SCAFFOLD — NOT WIRED TO ANY LIVE PAGE, NOT VERIFIED END-TO-END.
 *
 * pages/cart.js's "Continue to Payment" button does not call this; it is
 * still exactly the placeholder it always was (see
 * docs/ORDERS_FULFILLMENT_ARCHITECTURE.md). This file exists to show the
 * real shape of the future checkout endpoint — re-fetch authoritative
 * product data, validate, reserve inventory atomically, compute totals
 * server-side, create the order — using the exact same pure modules
 * (order/orderTotals.js, order/orderNumber.js, payments/providerRegistry.js)
 * the admin test-order tool already uses and that are already unit
 * tested. It has not been run: this environment has no Cloudflare
 * dashboard access to set SUPABASE_SERVICE_ROLE_KEY as a Pages secret, and
 * no way to invoke a deployed Function to confirm it actually works.
 *
 * Required Cloudflare Pages secrets (not yet configured):
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS; never log it, never echo it
 *   back in a response, never expose it to the browser.
 *
 * Never trusts the browser for price, availability, or totals — every
 * number here is re-derived server-side from the live `products` table.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../../../src/features/shop/api/config.js';
import { computeOrderTotals } from '../../../src/features/shop/order/orderTotals.js';
import { formatOrderNumber, parseOrderNumber } from '../../../src/features/shop/order/orderNumber.js';
import { getPaymentProvider } from '../../../src/features/shop/payments/providerRegistry.js';

const PUBLIC_STATUSES = ['available'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** @param {{request: Request, env: Record<string,string>}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    // Fails loudly rather than silently falling back to the anon key,
    // which would be RLS-blocked for an insert anyway — but failing
    // explicitly here is the honest "not configured yet" signal this
    // phase is supposed to produce, not a confusing downstream RLS error.
    return jsonResponse({ error: 'Checkout is not configured yet.' }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const { items, email, customerName, fulfillmentType, shippingAddress, paymentProvider } = input || {};
  if (!Array.isArray(items) || items.length === 0) return jsonResponse({ error: 'No items in order.' }, 400);
  if (!email || !fulfillmentType) return jsonResponse({ error: 'Missing required fields.' }, 400);

  const supabase = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Re-fetch every product server-side — the browser's prices/availability
  // are never trusted (section C / Security requirements).
  const productIds = items.map((i) => i.productId);
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, slug, price_cents, quantity, status, shipping_class, pickup_available, images:product_images(storage_path, is_primary, sort_order)')
    .in('id', productIds);
  if (productsError) return jsonResponse({ error: 'Could not load products.' }, 500);

  const orderItemsPayload = [];
  for (const requested of items) {
    const product = products.find((p) => p.id === requested.productId);
    if (!product || !PUBLIC_STATUSES.includes(product.status)) {
      return jsonResponse({ error: `A product in your cart is no longer available.` }, 409);
    }
    const quantity = Number(requested.quantity) || 0;
    if (quantity <= 0 || quantity > product.quantity) {
      return jsonResponse({ error: `Not enough stock for "${product.name}".` }, 409);
    }
    const primary = (product.images || []).find((img) => img.is_primary) || product.images?.[0];
    orderItemsPayload.push({
      product_id: product.id,
      product_name: product.name,
      product_slug: product.slug,
      product_image_url: primary ? supabase.storage.from('product-images').getPublicUrl(primary.storage_path).data.publicUrl : null,
      unit_price_cents: product.price_cents,
      quantity,
    });
  }

  const totals = computeOrderTotals({
    items: orderItemsPayload.map((i) => ({ priceCents: i.unit_price_cents, quantity: i.quantity })),
    // Real shipping/tax calculation is out of scope for this scaffold —
    // getShippingQuote (shipping/shippingProvider.js) already computes the
    // flat-rate shipping number the cart displays; a real implementation
    // re-derives it here the same way, server-side, rather than trusting it.
    shippingCents: 0,
  });

  const now = new Date();
  const dateParts = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const prefix = formatOrderNumber({ ...dateParts, sequence: 0 }).replace(/-0000$/, '-');
  const { count: existingCount } = await supabase.from('orders').select('id', { count: 'exact', head: true }).like('order_number', `${prefix}%`);
  let orderNumber = formatOrderNumber({ ...dateParts, sequence: (existingCount || 0) + 1 });

  // Same count-then-retry-on-collision pattern as admin/ordersApi.js's
  // adminCreateTestOrder — the COUNT above is only an optimistic starting
  // guess under concurrent checkouts; the unique index on order_number
  // plus this retry loop is what's actually race-safe.
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
        payment_provider: paymentProvider,
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        shipping_status: 'label_not_purchased',
        test_mode: false,
        status: 'pending',
      })
      .select('*')
      .single();

    if (!error) {
      order = data;
      break;
    }
    const isOrderNumberCollision = error.code === '23505' && (String(error.message || '').includes('order_number') || String(error.details || '').includes('order_number'));
    if (isOrderNumberCollision && attempt < 9) {
      const parsed = parseOrderNumber(orderNumber);
      orderNumber = formatOrderNumber({ ...dateParts, sequence: parsed.sequence + 1 });
      continue;
    }
    return jsonResponse({ error: 'Could not create order.' }, 500);
  }

  const { error: itemsError } = await supabase.from('order_items').insert(orderItemsPayload.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) return jsonResponse({ error: 'Could not create order items.' }, 500);

  for (const i of items) {
    const { error } = await supabase.rpc('reserve_inventory', { p_product_id: i.productId, p_quantity: i.quantity, p_order_id: order.id, p_ttl_minutes: 15 });
    if (error) return jsonResponse({ error: `Could not reserve inventory: ${error.message}` }, 409);
  }

  try {
    const provider = getPaymentProvider(paymentProvider);
    const session = await provider.createSession({ id: order.id, totalCents: totals.totalCents, currency: 'usd', email });
    return jsonResponse({ orderId: order.id, orderNumber, session });
  } catch (err) {
    // Provider not configured yet — the order row and its reservations
    // still exist, correctly in 'pending'. An admin can release the
    // reservation via Admin -> Orders if this needs cleaning up.
    return jsonResponse({ error: err instanceof Error ? err.message : 'Payment provider is not available.', orderId: order.id }, 503);
  }
}
