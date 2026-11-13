/**
 * Default/only-configured notification provider right now. Logs what
 * would have been sent and always returns sent: false — this is the
 * literal, honest truth (nothing was sent), not a placeholder pretending
 * success. A future real provider (e.g. Postmark) returns sent: true only
 * once that provider's API has actually confirmed acceptance.
 */
export const noopNotificationProvider = {
  name: 'noop',

  /** @param {{type: string, order: any, recipient: string}} event */
  async notify({ type, order, recipient }) {
    console.log(`[notifications:noop] would send "${type}" to ${recipient} for order ${order?.orderNumber || order?.id} — no provider configured, nothing sent.`);
    return { sent: false };
  },
};
