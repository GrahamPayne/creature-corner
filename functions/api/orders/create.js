/**
 * Real customer checkout endpoint — creates an order, reserves inventory
 * atomically, and starts a Stripe Checkout Session. Wired to pages/cart.js's
 * "Continue to Payment" button. Stripe Sandbox only until STRIPE_MODE is
 * explicitly "live" (enforced in stripeProvider.js's assertSandboxMode,
 * not just by convention).
 *
 * Talks to Supabase via plain fetch() against its REST/RPC API, not the
 * @supabase/supabase-js SDK — this project's Cloudflare Pages build has no
 * configured build command, so node_modules never exists on Cloudflare's
 * build machine before the Functions bundler runs; any npm-resolved
 * import fails there ("Could not resolve") even though it works locally
 * (see docs/ORDERS_FULFILLMENT_ARCHITECTURE.md for the full story).
 *
 * Required Cloudflare Pages secrets:
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS; never logged, never echoed back.
 *   STRIPE_SECRET_KEY — sk_test_... in Sandbox; never logged, never echoed back.
 * Optional:
 *   STRIPE_MODE — must be exactly "live" to allow a non-sk_test_ key; absent/anything else keeps Sandbox-only enforcement.
 *   STRIPE_AUTOMATIC_TAX — "true" to enable Stripe Tax; defaults off (see Sales Tax notes in the architecture doc).
 *
 * Never trusts the browser for price, availability, shipping cost, or
 * totals — every number here is re-derived server-side.
 */
import { SUPABASE_URL } from '../../../src/features/shop/api/config.js';
import { computeOrderTotals } from '../../../src/features/shop/order/orderTotals.js';
import { formatOrderNumber, parseOrderNumber } from '../../../src/features/shop/order/orderNumber.js';
import { getPaymentProvider } from '../../../src/features/shop/payments/providerRegistry.js';
import { getShippingQuote } from '../../../src/features/shop/shipping/shippingProvider.js';
import { determineFulfillmentOptions } from '../../../src/features/shop/cart/shippingRules.js';
import { assertSandboxMode } from '../../../src/features/shop/payments/providers/stripeProvider.js';

const PUBLIC_STATUSES = ['available'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * TEMPORARY, for diagnosing a live "Could not load products" incident —
 * remove once resolved. Console-only (never in any HTTP response):
 * decodes (never verifies — the signature is never checked, this is not
 * authentication) a legacy Supabase JWT's `ref`/`role` claims and reports
 * only whether they match this project/service_role, as booleans. JWT
 * payloads are signed, not encrypted, so reading claims here exposes
 * nothing the token doesn't already expose to its holder; this still
 * logs only the comparison result, never the claims or the key itself.
 * @param {Record<string,string>} env
 */
function diagnoseServiceRoleKeyClaims(env) {
  try {
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const expectedRef = new URL(SUPABASE_URL).hostname.split('.')[0];
    if (typeof key !== 'string') return { keyType: typeof key };
    const parts = key.split('.');
    if (parts.length !== 3) return { keyShape: 'not-a-3-part-jwt' };
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      projectMatches: payload.ref === expectedRef,
      roleMatches: payload.role === 'service_role',
      notExpired: typeof payload.exp !== 'number' || payload.exp > nowSeconds,
    };
  } catch {
    return { keyShape: 'decode-failed' };
  }
}

/** Minimal PostgREST client — see admin/ordersApi.js's docs for why this exists instead of the SDK. */
function createSupabaseRest(url, serviceRoleKey) {
  const base = `${url}/rest/v1`;
  const authHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

  async function request(path, init = {}) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...authHeaders, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const error = Array.isArray(body) ? body[0] : body;
      return { data: null, error: error || { message: `HTTP ${res.status}` }, count: null };
    }
    const contentRange = res.headers.get('content-range');
    const count = contentRange && contentRange.includes('/') ? Number(contentRange.split('/')[1]) : null;
    return { data: body, error: null, count };
  }

  return {
    async select(table, select, filters = {}) {
      const params = new URLSearchParams({ select });
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`);
    },
    async count(table, filters = {}) {
      const params = new URLSearchParams({ select: 'id' });
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`, { headers: { Prefer: 'count=exact' } });
    },
    async insertOne(table, row) {
      const { data, error } = await request(`/${table}`, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
      return { data: Array.isArray(data) ? data[0] : data, error };
    },
    async insertMany(table, rows) {
      return request(`/${table}`, { method: 'POST', body: JSON.stringify(rows) });
    },
    async update(table, patch, filters) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`, { method: 'PATCH', body: JSON.stringify(patch) });
    },
    async rpc(fn, args) {
      return request(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    },
    getPublicUrl(bucket, path) {
      return `${url}/storage/v1/object/public/${bucket}/${path}`;
    },
  };
}

/** @param {{request: Request, env: Record<string,string>}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Checkout is not configured yet.' }, 503);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const { items, email, customerName, fulfillmentType, shippingAddress } = input || {};
  if (!Array.isArray(items) || items.length === 0) return jsonResponse({ error: 'No items in order.' }, 400);
  if (items.length > 100 || items.some((i) => !i || typeof i.productId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i.productId) || !Number.isSafeInteger(i.quantity) || i.quantity < 1) || new Set(items.map((i) => i.productId)).size !== items.length) {
    return jsonResponse({ error: 'Each product must have a unique ID and a positive whole-number quantity.' }, 400);
  }
  if (!email || !fulfillmentType) return jsonResponse({ error: 'Missing required fields.' }, 400);
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof customerName !== 'string' || !customerName.trim() || customerName.length > 200) return jsonResponse({ error: 'Enter a valid name and email.' }, 400);
  if (fulfillmentType !== 'shipping' && fulfillmentType !== 'pickup') return jsonResponse({ error: 'Invalid fulfillment type.' }, 400);
  if (fulfillmentType === 'shipping' && (!shippingAddress || ['line1', 'city', 'state', 'zip'].some((key) => typeof shippingAddress[key] !== 'string' || !shippingAddress[key].trim() || shippingAddress[key].length > 200))) return jsonResponse({ error: 'Enter a complete shipping address.' }, 400);
  try {
    assertSandboxMode(env);
  } catch {
    return jsonResponse({ error: 'Checkout payment configuration is not ready.' }, 503);
  }

  const db = createSupabaseRest(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Re-fetch every product server-side — the browser's prices/availability/
  // shipping class are never trusted (Payment Security / section C).
  const productIds = items.map((i) => i.productId);
  const { data: products, error: productsError } = await db.select(
    'products',
    'id,name,slug,price_cents,quantity,status,shipping_class,pickup_available,images:product_images(storage_path,is_primary,sort_order)',
    { id: `in.(${productIds.join(',')})` }
  );
  if (productsError) {
    // Never echo DB errors to the client (Payment Security / section C) —
    // logged server-side only so a real failure here (bad credentials,
    // RLS, schema drift) is diagnosable instead of a bare 500.
    console.error('Could not load products for checkout', productsError, diagnoseServiceRoleKeyClaims(env));
    return jsonResponse({ error: 'Could not load products.' }, 500);
  }

  const orderItemsPayload = [];
  for (const requested of items) {
    const product = products.find((p) => p.id === requested.productId);
    if (!product || !PUBLIC_STATUSES.includes(product.status)) {
      return jsonResponse({ error: 'A product in your cart is no longer available.' }, 409);
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
      product_image_url: primary ? db.getPublicUrl('product-images', primary.storage_path) : null,
      unit_price_cents: product.price_cents,
      quantity,
      shippingClass: product.shipping_class,
      pickupAvailable: product.pickup_available,
    });
  }

  // Same fulfillment-conflict rule pages/cart.js enforces client-side
  // (determineFulfillmentOptions) — re-checked here because the browser's
  // choice of fulfillmentType is never trusted.
  const fulfillmentOptions = determineFulfillmentOptions(orderItemsPayload);
  if (fulfillmentType === 'shipping' && !fulfillmentOptions.shippingAvailable) {
    return jsonResponse({ error: 'This cart cannot be shipped — one or more items are local-pickup only.' }, 409);
  }
  if (fulfillmentType === 'pickup' && !fulfillmentOptions.pickupAvailable) {
    return jsonResponse({ error: 'This cart cannot be picked up locally — one or more items must ship.' }, 409);
  }

  // Real, server-computed shipping — never assume free shipping, never
  // trust a client-supplied amount (section F).
  const { data: shippingClasses, error: shippingClassesError } = await db.select('shipping_classes', '*');
  if (shippingClassesError) return jsonResponse({ error: 'Could not load shipping configuration.' }, 500);
  const rateByClass = Object.fromEntries(shippingClasses.map((c) => [c.key, c.flat_price_cents]));
  const shippingQuote = getShippingQuote({ items: orderItemsPayload, fulfillment: fulfillmentType, rateByClass });
  if (!shippingQuote.configured) {
    return jsonResponse({ error: shippingQuote.manualQuote ? 'One or more items need a custom shipping quote — contact us before checkout.' : 'Shipping is not yet configured for this order.' }, 409);
  }

  // Stripe Tax requires a completed, active tax registration (not done —
  // see Sales Tax notes in docs/ORDERS_FULFILLMENT_ARCHITECTURE.md). Zero,
  // explicitly, not omitted, until that's resolved and STRIPE_AUTOMATIC_TAX
  // is turned on.
  const totals = computeOrderTotals({
    items: orderItemsPayload.map((i) => ({ priceCents: i.unit_price_cents, quantity: i.quantity })),
    shippingCents: shippingQuote.cents,
    taxCents: 0,
  });

  const now = new Date();
  const dateParts = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  const prefix = formatOrderNumber({ ...dateParts, sequence: 0 }).replace(/-0000$/, '-');
  const { count: existingCount } = await db.count('orders', { order_number: `like.${prefix}%` });
  let orderNumber = formatOrderNumber({ ...dateParts, sequence: (existingCount || 0) + 1 });

  // Same count-then-retry-on-collision pattern as admin/ordersApi.js's
  // adminCreateTestOrder — the count above is only an optimistic starting
  // guess under concurrent checkouts; the unique index on order_number
  // plus this retry loop is what's actually race-safe.
  let order;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await db.insertOne('orders', {
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
      payment_provider: 'stripe',
      payment_status: 'pending',
      fulfillment_status: 'unfulfilled',
      shipping_status: 'label_not_purchased',
      test_mode: false,
      status: 'pending',
    });

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

  const { error: itemsError } = await db.insertMany('order_items', orderItemsPayload.map(({ shippingClass, pickupAvailable, ...i }) => ({ ...i, order_id: order.id })));
  if (itemsError) return jsonResponse({ error: 'Could not create order items.' }, 500);

  const reservedIds = [];
  async function releaseAttempt() {
    for (const id of reservedIds) {
      const { error } = await db.rpc('release_reservation', { p_reservation_id: id });
      if (error) console.error('Checkout reservation cleanup failed', order.id);
    }
  }
  // Stripe requires at least 30 minutes. The inventory hold includes a
  // short delivery allowance beyond the session's 31-minute lifetime.
  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
  for (const i of items) {
    const { data: reservation, error } = await db.rpc('reserve_inventory', { p_product_id: i.productId, p_quantity: i.quantity, p_order_id: order.id, p_ttl_minutes: 35 });
    if (error) {
      await releaseAttempt();
      return jsonResponse({ error: 'An item could not be reserved. Refresh your cart and try again.' }, 409);
    }
    if (reservation?.id) reservedIds.push(reservation.id);
  }

  const origin = new URL(request.url).origin;
  try {
    const provider = getPaymentProvider('stripe');
    const session = await provider.createSession(
      {
        id: order.id,
        expiresAt,
        orderNumber,
        totalCents: totals.totalCents,
        shippingCents: totals.shippingCents,
        taxCents: totals.taxCents,
        currency: 'usd',
        email,
        items: orderItemsPayload.map((i) => ({ name: i.product_name, unitPriceCents: i.unit_price_cents, quantity: i.quantity, imageUrl: i.product_image_url })),
        // {CHECKOUT_SESSION_ID} is a literal Stripe template placeholder —
        // Stripe substitutes it, this code never generates its own value.
        successUrl: `${origin}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/cart?checkout=cancelled`,
      },
      env
    );

    let { error: refError } = await db.update('orders', { payment_reference: session.reference }, { id: `eq.${order.id}` });
    if (refError) {
      // functions/api/orders/status.js looks orders up by payment_reference
      // for the order-confirmation page — a transient failure here would
      // otherwise strand that page even though the order/session are fine.
      ({ error: refError } = await db.update('orders', { payment_reference: session.reference }, { id: `eq.${order.id}` }));
      if (refError) {
        console.error('Could not persist checkout reference', order.id);
        return jsonResponse({ error: 'Checkout could not be saved. Please try again later.' }, 503);
      }
    }

    return jsonResponse({ orderId: order.id, orderNumber, redirectUrl: session.redirectUrl });
  } catch (err) {
    // Provider not configured/refused — the order row and its reservations
    // still exist, correctly in 'pending'. An admin can release the
    // reservation via Admin -> Orders if this needs cleaning up; nothing
    // was charged, nothing was lost.
    return jsonResponse({ error: err instanceof Error ? err.message : 'Payment provider is not available.', orderId: order.id }, 503);
  }
}
