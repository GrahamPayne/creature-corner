/**
 * Safe Test Mode's payment provider (section J). This is the one
 * PaymentProvider implementation that's actually "live" right now — but
 * it never touches a real payment network, never charges anyone, and is
 * only ever invoked from the admin-only test-order tool (see
 * admin/ordersApi.js's adminCreateTestOrder/adminConfirmTestPayment), not
 * from the public checkout page. Every order it touches is created with
 * test_mode: true and payment_provider: 'test', which the admin UI badges
 * unmistakably (see admin/ordersTable.js) so a test order can never be
 * mistaken for a real paid one.
 *
 * "Confirming" a test payment is an explicit admin action, not a fake
 * webhook or browser-supplied success flag — see Payment Security: real
 * providers must verify payment server-side; this provider sidesteps that
 * requirement honestly, by only ever being reachable from an authenticated
 * admin session making a deliberate choice, never from a customer.
 */
function randomId(prefix) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`;
}

export const testProvider = {
  name: 'test',

  /** @param {import('../paymentProvider.js').OrderForSession} order @param {Record<string,string>} [env] */
  async createSession(order, env) {
    return {
      provider: 'test',
      reference: randomId('test_session'),
      redirectUrl: undefined,
      clientSecret: undefined,
    };
  },

  /**
   * Not a real signature scheme — test mode has no real webhook sender.
   * Exists purely so this provider satisfies the same interface every
   * real provider does, and so the admin-only "simulate a webhook"
   * regression test can exercise the same code path a real provider's
   * webhook handler would.
   * @param {string} rawBody @param {string} signatureHeader @param {string} secret
   */
  verifyWebhookSignature(rawBody, signatureHeader, secret) {
    return signatureHeader === secret;
  },

  /** @param {string} rawBody */
  parseWebhookEvent(rawBody) {
    const body = JSON.parse(rawBody);
    return {
      provider: 'test',
      providerEventId: body.eventId || randomId('test_evt'),
      type: body.type || 'payment.succeeded',
      reference: body.reference,
      amountCents: body.amountCents,
      raw: body,
    };
  },

  /** @param {string} reference @param {Record<string,string>} [env] */
  async getTransaction(reference, env) {
    // Test mode has no external ledger to re-query — admin-confirmed is the
    // only "verification" that exists, recorded directly on the order row.
    return { status: 'test_confirmed', amountCents: 0, raw: { reference } };
  },

  /** @param {string} reference @param {number} [amountCents] @param {Record<string,string>} [env] */
  async refund(reference, amountCents, env) {
    return { refundReference: randomId('test_refund'), amountCents: amountCents ?? 0 };
  },
};
