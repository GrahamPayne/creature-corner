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
 * @typedef {Object} PaymentProvider
 * @property {string} name
 * @property {(order: {id: string, totalCents: number, currency: string, email: string}) => Promise<PaymentSession>} createSession
 *   Creates a payment session/order with the provider for the given internal order. Never called from the browser for a real provider.
 * @property {(request: {headers: Record<string,string>, rawBody: string}, secret: string) => boolean} verifyWebhookSignature
 *   Verifies a webhook request actually came from the provider, using the provider's documented signing scheme. Must be checked before trusting ANY webhook payload — see Payment Security requirements.
 * @property {(request: {headers: Record<string,string>, rawBody: string}) => PaymentEvent} parseWebhookEvent
 *   Parses an already-signature-verified webhook body into the normalized PaymentEvent shape.
 * @property {(reference: string) => Promise<{status: string, amountCents: number, raw: any}>} getTransaction
 *   Server-side re-fetch of a transaction's authoritative status directly from the provider — never trust a client-supplied "payment succeeded" flag; always re-verify like this (or via a verified webhook) before marking an order paid.
 * @property {(reference: string, amountCents?: number) => Promise<{refundReference: string, amountCents: number}>} refund
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
