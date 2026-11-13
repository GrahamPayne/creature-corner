/**
 * Notification provider interface (section I) — same pattern as payments
 * and shipping labels: core order code emits an event, never calls an
 * email API directly. The only implementation wired up today is
 * noopNotificationProvider.js, which logs intent and genuinely sends
 * nothing — "do not send customer emails during testing" and "do not
 * claim notifications have been delivered until a real email provider has
 * confirmed acceptance" are both satisfied by construction, not by
 * convention someone has to remember.
 *
 * @typedef {'order.paid'|'order.confirmation'|'order.shipped'|'order.tracking_added'|'order.refunded'|'order.cancelled'} OrderEventType
 *
 * @typedef {Object} NotificationProvider
 * @property {string} name
 * @property {(event: {type: OrderEventType, order: any, recipient: string}) => Promise<{sent: boolean, providerMessageId?: string}>} notify
 *   Returns sent:true ONLY once the real provider (future SendGrid/Postmark/etc.) has confirmed acceptance — never optimistically.
 */

export const NOTIFICATION_PROVIDER_CONTRACT = ['name', 'notify'];

/** @param {any} provider @returns {boolean} */
export function implementsNotificationProviderContract(provider) {
  return NOTIFICATION_PROVIDER_CONTRACT.every((key) => key in provider);
}
