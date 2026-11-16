/**
 * Payment provider interface (mirrors shipping/shippingProvider.js's
 * existing abstraction style). Core order logic never calls Stripe,
 * PayPal, or Square directly — it calls whichever provider module is
 * configured, through this exact shape. A new provider is a drop-in file
 * under payments/providers/ that implements the same function names;
 * nothing in orderStates.js, orderTotals.js, or the admin UI needs to
 * change to support it.
 *
 * All of this is SERVER-SIDE-ONLY by design: real providers need a secret
 * API key (never shipped to the browser — see docs/SHOP_SETUP.md's
 * SUPABASE_SERVICE_ROLE_KEY precedent and docs/SHIPPING_ARCHITECTURE.md's
 * identical EASYPOST_API_KEY plan). The one provider actually usable from
 * the browser today is providers/testProvider.js, which never touches a
 * real payment network at all (see Safe Test Mode in
 * docs/ORDERS_FULFILLMENT_ARCHITECTURE.md).
 *
 * @typedef {Object} PaymentSession
 * @property {string} provider
 * @property {string} reference - provider-specific session/order id
 * @property {string} [redirectUrl] - where to send the customer to pay, if applicable
 * @property {string} [clientSecret] - for providers using client-side confirmation (e.g. Stripe Elements)
 *
 * @typedef {Object} PaymentEvent
 * @property {string} provider
 * @property {string} providerEventId - external event id, the idempotency key (see payment_events table)
 * @property {string} type - e.g. 'payment.succeeded', 'payment.failed', 'refund.created'
 * @property {string} [reference] - the session/transaction/order reference this event is about
 * @property {number} [amountCents]
 * @property {any} raw - the original provider payload, stored verbatim for auditability
 *
 * @typedef {Object} OrderForSession
 * @property {string} id
 * @property {string} orderNumber
 * @property {number} totalCents
 * @property {number} shippingCents
 * @property {number} taxCents
 * @property {string} currency
 * @property {string} email
 * @property {{name: string, unitPriceCents: number, quantity: number, imageUrl?: string}[]} items
 * @property {string} successUrl
 * @property {string} cancelUrl
 * @property {number} [expiresAt] - payment session expiration, Unix seconds
 *
 * @typedef {Object} PaymentProvider
 * @property {string} name
 * @property {(order: OrderForSession, env: Record<string,string>) => Promise<PaymentSession>} createSession
 *   Creates a payment session/order with the provider for the given internal order. Never called from the browser for a real provider.
 *   `env` carries whatever server-side secrets this provider needs (e.g. env.STRIPE_SECRET_KEY) — passed through from the Cloudflare Pages Function's context, never hardcoded to one provider's credential shape.
 * @property {(rawBody: string, signatureHeader: string, secret: string) => boolean|Promise<boolean>} verifyWebhookSignature
 *   Verifies a webhook request actually came from the provider, using the provider's documented signing scheme, against the RAW (unparsed) request body. Must be checked before trusting ANY webhook payload — see Payment Security requirements.
 * @property {(rawBody: string) => PaymentEvent} parseWebhookEvent
 *   Parses an already-signature-verified webhook body into the normalized PaymentEvent shape.
 * @property {(reference: string, env: Record<string,string>) => Promise<{status: string, amountCents: number, raw: any}>} getTransaction
 *   Server-side re-fetch of a transaction's authoritative status directly from the provider — never trust a client-supplied "payment succeeded" flag; always re-verify like this (or via a verified webhook) before marking an order paid.
 * @property {(reference: string, amountCents: number|undefined, env: Record<string,string>) => Promise<{refundReference: string, amountCents: number}>} refund
 *   Full refund if amountCents is omitted, partial refund otherwise.
 */

/** Function names every PaymentProvider implementation must export. Used by tests to assert interface compliance. */
export const PAYMENT_PROVIDER_CONTRACT = ['name', 'createSession', 'verifyWebhookSignature', 'parseWebhookEvent', 'getTransaction', 'refund'];

/** @param {any} provider @returns {boolean} */
export function implementsPaymentProviderContract(provider) {
  return PAYMENT_PROVIDER_CONTRACT.every((key) => key in provider);
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerName) {
    super(`${providerName} is not configured yet — this phase builds the integration boundary only (see docs/ORDERS_FULFILLMENT_ARCHITECTURE.md). No live credentials are connected.`);
    this.name = 'ProviderNotConfiguredError';
  }
}
