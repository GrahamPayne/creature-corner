/**
 * Stripe payment provider — real implementation, Sandbox-only until
 * STRIPE_MODE is explicitly set to "live" (see assertSandboxMode below).
 *
 * Talks to Stripe's REST API via plain fetch() — no `stripe` npm package.
 * Same reasoning as the Supabase REST client in functions/api/orders/
 * create.js: this project's Cloudflare Pages build has no configured
 * build command, so node_modules never exists on Cloudflare's build
 * machine, so any npm-resolved import fails there with "Could not
 * resolve" even though it works locally. Stripe's API is well-documented,
 * stable, and form-encoded — not worth fighting the build pipeline for.
 *
 * Signature verification uses the Workers-native Web Crypto API
 * (crypto.subtle), not Node's `crypto` module, for the same reason.
 */
import { ProviderNotConfiguredError } from '../paymentProvider.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Refuses to proceed with a non-sandbox key unless STRIPE_MODE is
 * explicitly "live" — a deliberate human action, never a default. This is
 * the actual enforcement behind "Do not activate live payments yet": even
 * if a live key were pasted into the wrong Cloudflare environment by
 * mistake, this still blocks it from being used to create a real charge.
 * @param {Record<string,string>} env
 */
function assertSandboxMode(env) {
  if (!env?.STRIPE_SECRET_KEY) throw new ProviderNotConfiguredError('Stripe');
  const isSandboxKey = env.STRIPE_SECRET_KEY.startsWith('sk_test_');
  const liveExplicitlyEnabled = env.STRIPE_MODE === 'live';
  if (!isSandboxKey && !liveExplicitlyEnabled) {
    throw new Error(
      'Refusing to use a Stripe key that is not a recognized Sandbox key (sk_test_) while STRIPE_MODE is not explicitly "live". This safety check exists specifically to prevent accidentally activating real payments.'
    );
  }
}

/** Stripe's form-encoding for nested objects/arrays: line_items[0][price_data][unit_amount]=2500. */
function appendStripeParam(params, value, key) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => appendStripeParam(params, item, `${key}[${i}]`));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) appendStripeParam(params, v, `${key}[${k}]`);
  } else {
    params.append(key, String(value));
  }
}

function toStripeFormBody(obj) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) appendStripeParam(params, value, key);
  return params;
}

/** @param {string} path @param {{method?: string, body?: URLSearchParams, secretKey: string}} opts */
async function stripeRequest(path, { method = 'GET', body, secretKey }) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe request failed (${res.status}).`);
  return data;
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string comparison — avoids leaking timing information that could help an attacker guess a valid signature byte-by-byte. */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export const stripeProvider = {
  name: 'stripe',

  /**
   * @param {import('../paymentProvider.js').OrderForSession} order
   * @param {Record<string,string>} env
   */
  async createSession(order, env) {
    assertSandboxMode(env);

    const lineItems = order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: order.currency,
        unit_amount: item.unitPriceCents,
        product_data: {
          name: item.name,
          images: item.imageUrl ? [item.imageUrl] : undefined,
        },
      },
    }));

    // Shipping/tax are separate line items rather than Stripe's dedicated
    // shipping_options — this project computes both server-side from its
    // own rules (shipping/shippingProvider.js) and must never let Stripe
    // silently substitute its own number for either.
    if (order.shippingCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: { currency: order.currency, unit_amount: order.shippingCents, product_data: { name: 'Shipping', images: undefined } },
      });
    }
    if (order.taxCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: { currency: order.currency, unit_amount: order.taxCents, product_data: { name: 'Sales Tax', images: undefined } },
      });
    }

    const data = await stripeRequest('/checkout/sessions', {
      method: 'POST',
      secretKey: env.STRIPE_SECRET_KEY,
      body: toStripeFormBody({
        mode: 'payment',
        customer_email: order.email,
        line_items: lineItems,
        success_url: order.successUrl,
        cancel_url: order.cancelUrl,
        // Stripe Tax requires a completed, active tax registration per
        // jurisdiction — not done yet (see docs/ORDERS_FULFILLMENT_ARCHITECTURE.md).
        // Flipping this on is a Cloudflare env var away, once registration
        // is complete; it must never default to on.
        automatic_tax: { enabled: env.STRIPE_AUTOMATIC_TAX === 'true' },
        metadata: { order_id: order.id, order_number: order.orderNumber },
        payment_intent_data: { metadata: { order_id: order.id, order_number: order.orderNumber } },
      }),
    });

    return { provider: 'stripe', reference: data.id, redirectUrl: data.url, clientSecret: data.client_secret };
  },

  /**
   * Stripe's documented scheme: header is `t=<timestamp>,v1=<hex hmac>`
   * (possibly with an older v0 too, ignored here). The signed payload is
   * `${timestamp}.${rawBody}` — this MUST be the raw, unparsed request
   * body; re-serializing a parsed-then-reserialized JSON object changes
   * whitespace/key order and the signature will never match.
   * @param {string} rawBody @param {string} signatureHeader @param {string} secret
   */
  async verifyWebhookSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const parts = Object.fromEntries(signatureHeader.split(',').map((kv) => kv.split('=')));
    const timestamp = parts.t;
    const expectedSig = parts.v1;
    if (!timestamp || !expectedSig) return false;

    // Reject stale timestamps — without this, a signature captured once
    // (e.g. from a compromised log) could be replayed indefinitely.
    const toleranceSeconds = 5 * 60;
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) return false;

    const computedSig = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
    return constantTimeEqual(computedSig, expectedSig);
  },

  /** @param {string} rawBody */
  parseWebhookEvent(rawBody) {
    const event = JSON.parse(rawBody);
    const object = event.data?.object || {};
    return {
      provider: 'stripe',
      providerEventId: event.id,
      type: event.type,
      reference: object.id,
      amountCents: object.amount_total ?? object.amount ?? undefined,
      raw: event,
    };
  },

  /** @param {string} reference @param {Record<string,string>} env */
  async getTransaction(reference, env) {
    const data = await stripeRequest(`/checkout/sessions/${encodeURIComponent(reference)}`, { secretKey: env.STRIPE_SECRET_KEY });
    return { status: data.payment_status, amountCents: data.amount_total, raw: data };
  },

  /**
   * @param {string} reference - a PaymentIntent id (not a Checkout Session id — Stripe refunds the charge/intent, not the session)
   * @param {number|undefined} amountCents - full refund if omitted
   * @param {Record<string,string>} env
   */
  async refund(reference, amountCents, env) {
    assertSandboxMode(env);
    const data = await stripeRequest('/refunds', {
      method: 'POST',
      secretKey: env.STRIPE_SECRET_KEY,
      body: toStripeFormBody({ payment_intent: reference, amount: amountCents }),
    });
    return { refundReference: data.id, amountCents: data.amount };
  },
};
