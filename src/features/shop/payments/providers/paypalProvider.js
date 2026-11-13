/**
 * PayPal payment provider — NOT CONNECTED. Every method throws
 * ProviderNotConfiguredError. Deliberately independent of stripeProvider.js
 * (PayPal orders are never routed through Stripe) — the only thing they
 * share is the PaymentProvider interface shape (payments/paymentProvider.js).
 *
 * Handoff checklist for later:
 *
 * 1. Receive PayPal Sandbox REST API client id/secret.
 * 2. Add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET as Cloudflare Pages
 *    server-side secrets.
 * 3. Add PAYPAL_WEBHOOK_ID (PayPal verifies webhooks via its own
 *    Verify-Webhook-Signature API call, not a local HMAC check like
 *    Stripe — verifyWebhookSignature below will need to make a server-
 *    side request to PayPal with this id plus the webhook headers/body).
 * 4. createSession(order): POST to PayPal's Orders v2 API
 *    (`/v2/checkout/orders`) with purchase_units built from the order's
 *    snapshot; return the PayPal order id as `reference` and the
 *    `approve` HATEOAS link as `redirectUrl`.
 * 5. Build functions/api/webhooks/paypal.js: call PayPal's
 *    verify-webhook-signature endpoint, check payment_events for
 *    (provider='paypal', provider_event_id=event.id) before processing,
 *    then update payment_status via the same core order-service
 *    functions every provider uses.
 * 6. getTransaction(reference): GET
 *    `/v2/checkout/orders/{id}` — defense-in-depth re-check only.
 * 7. refund(reference, amountCents): POST to the capture's `/refund` link.
 * 8. Verify end-to-end against the PayPal Sandbox before any live
 *    credentials are connected.
 *
 * None of these steps are implemented yet.
 */
import { ProviderNotConfiguredError } from '../paymentProvider.js';

function notConfigured() {
  throw new ProviderNotConfiguredError('PayPal');
}

export const paypalProvider = {
  name: 'paypal',
  async createSession() { notConfigured(); },
  verifyWebhookSignature() { notConfigured(); },
  parseWebhookEvent() { notConfigured(); },
  async getTransaction() { notConfigured(); },
  async refund() { notConfigured(); },
};
