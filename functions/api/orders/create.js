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
 * tested.
 *
 * Talks to Supabase via plain fetch() against its REST/RPC API instead of
 * the @supabase/supabase-js SDK: this project's Cloudflare Pages build
 * has no configured build command, so node_modules is never installed on
 * Cloudflare's build machine before the Functions bundler runs — any
 * npm-resolved import fails there with "Could not resolve" even though it
 * resolves fine locally (this repo's own node_modules already exists
 * here). Rather than add a build step this project has deliberately never
 * had (see CLAUDE.md: "No framework, no bundler, no build step"), this
 * Function has zero npm dependencies of its own — it only imports plain,
 * dependency-free local JS modules, which bundle from source with no
 * installation step needed, the same way every browser-side file in this
 * repo already does. Supabase's SDK is a thin wrapper over this exact
 * REST/RPC API; using it directly here isn't a workaround, it's removing
 * a dependency this one file never needed.
 *
 * Required Cloudflare Pages secrets (not yet configured):
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS; never log it, never echo it
 *   back in a response, never expose it to the browser.
 *
 * Never trusts the browser for price, availability, or totals — every
 * number here is re-derived server-side from the live `products` table.
 */
import { SUPABASE_URL } from '../../../src/features/shop/api/config.js';
import { computeOrderTotals } from '../../../src/features/shop/order/orderTotals.js';
import { formatOrderNumber, parseOrderNumber } from '../../../src/features/shop/order/orderNumber.js';
import { getPaymentProvider } from '../../../src/features/shop/payments/providerRegistry.js';

const PUBLIC_STATUSES = ['available'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Minimal PostgREST client — just the handful of operations this
 * endpoint needs (select/insert/rpc/public-storage-URL), built on the
 * Workers-native fetch(), no SDK. Every request carries the service-role
 * key, which bypasses RLS entirely — this must only ever run server-side.
 */
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
    /** @param {string} table @param {string} select @param {Record<string,string>} [filters] */
    async select(table, select, filters = {}) {
      const params = new URLSearchParams({ select });
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`);
    },
    /** Count-only lookup (no rows needed) — Prefer: count=exact puts the total in the Content-Range response header. */
    async count(table, filters = {}) {
      const params = new URLSearchParams({ select: 'id' });
      for (const [key, value] of Object.entries(filters)) params.append(key, value);
      return request(`/${table}?${params.toString()}`, { headers: { Prefer: 'count=exact' } });
    },
    /** @param {string} table @param {any} row */
    async insertOne(table, row) {
      const { data, error } = await request(`/${table}`, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
      return { data: Array.isArray(data) ? data[0] : data, error };
    },
    /** @param {string} table @param {any[]} rows */
    async insertMany(table, rows) {
      return request(`/${table}`, { method: 'POST', body: JSON.stringify(rows) });
    },
    /** @param {string} fn @param {any} args */
    async rpc(fn, args) {
      return request(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    },
    /** @param {string} bucket @param {string} path */
    getPublicUrl(bucket, path) {
      return `${url}/storage/v1/object/public/${bucket}/${path}`;
    },
  };
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

  const db = createSupabaseRest(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Re-fetch every product server-side — the browser's prices/availability
  // are never trusted (section C / Security requirements).
  const productIds = items.map((i) => i.productId);
  const { data: products, error: productsError } = await db.select(
    'products',
    'id,name,slug,price_cents,quantity,status,shipping_class,pickup_available,images:product_images(storage_path,is_primary,sort_order)',
    { id: `in.(${productIds.join(',')})` }
  );
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
      product_image_url: primary ? db.getPublicUrl('product-images', primary.storage_path) : null,
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
      payment_provider: paymentProvider,
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

  const { error: itemsError } = await db.insertMany('order_items', orderItemsPayload.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) return jsonResponse({ error: 'Could not create order items.' }, 500);

  for (const i of items) {
    const { error } = await db.rpc('reserve_inventory', { p_product_id: i.productId, p_quantity: i.quantity, p_order_id: order.id, p_ttl_minutes: 15 });
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
