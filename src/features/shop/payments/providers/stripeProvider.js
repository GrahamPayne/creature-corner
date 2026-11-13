/**
 * Stripe payment provider — NOT CONNECTED. Every method throws
 * ProviderNotConfiguredError. This file exists to document exactly how
 * Stripe will plug into the PaymentProvider interface (payments/
 * paymentProvider.js) once credentials exist, and to prove the interface
 * shape is actually implementable by a real provider, not just Test Mode.
 *
 * Handoff checklist for later (mirrors docs/SHIPPING_ARCHITECTURE.md's
 * EasyPost checklist):
 *
 * 1. Receive a Stripe test secret key.
 * 2. Add STRIPE_SECRET_KEY as a Cloudflare Pages server-side secret —
 *    never committed, never shipped to the browser (same rule as
 *    SUPABASE_SERVICE_ROLE_KEY today).
 * 3. Add STRIPE_WEBHOOK_SECRET as a second secret, used only by
 *    verifyWebhookSignature below (Stripe signs webhook bodies with
 *    HMAC-SHA256 over `${timestamp}.${rawBody}`, compared against the
 *    `Stripe-Signature` header — see Stripe's webhook docs for the exact
 *    algorithm; must use the RAW, unparsed request body, not a re-
 *    serialized JSON object, or the signature will never match).
 * 4. createSession(order): POST to Stripe's Checkout Sessions API with
 *    line items built from the order's snapshot (never re-trust a
 *    client-supplied price), success_url/cancel_url pointing back at the
 *    order confirmation page, and metadata.orderId = order.id so the
 *    webhook handler can find the order again without trusting anything
 *    else in the payload.
 * 5. Build functions/api/webhooks/stripe.js: verify the signature with
 *    STRIPE_WEBHOOK_SECRET, check payment_events for
 *    (provider='stripe', provider_event_id=event.id) before processing
 *    (idempotency), then update the order's payment_status via the same
 *    core order-service functions the admin test-order tool uses.
 * 6. getTransaction(reference): GET the PaymentIntent/Session from
 *    Stripe's API — used as a defense-in-depth re-check, never the
 *    primary trust path (the verified webhook is).
 * 7. refund(reference, amountCents): POST to Stripe's Refunds API.
 * 8. Verify end-to-end in Stripe test mode before ever touching a live key.
 *
 * None of these steps are implemented yet — this file only reserves the
 * seam they'll plug into, per the "build infrastructure now, connect
 * providers later" requirement.
 */
import { ProviderNotConfiguredError } from '../paymentProvider.js';

function notConfigured() {
  throw new ProviderNotConfiguredError('Stripe');
}

export const stripeProvider = {
  name: 'stripe',
  async createSession() { notConfigured(); },
  verifyWebhookSignature() { notConfigured(); },
  parseWebhookEvent() { notConfigured(); },
  async getTransaction() { notConfigured(); },
  async refund() { notConfigured(); },
};
