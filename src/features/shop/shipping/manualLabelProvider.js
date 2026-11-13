import { ShippingProviderNotConfiguredError } from './labelProvider.js';

/**
 * The only shipping label "provider" usable today (section H: "allow
 * manual tracking entry and fulfillment management" / "do not implement a
 * button that pretends to purchase or print a nonexistent label"). It
 * never purchases anything and never quotes a real rate — getRates and
 * purchaseLabel are intentionally unimplemented so nothing in the admin
 * UI can accidentally wire up a fake "Buy Label" button against this.
 * validateAddress/getTracking are honest no-ops (nothing to validate or
 * track without a real carrier), and getLabel/refundLabel simply aren't
 * meaningful without a purchased label to reference.
 *
 * What this DOES support, for real: admin/orderDetail.js's "Add Tracking"
 * action writes shipping_carrier/shipping_service/tracking_number
 * directly onto the order (see admin/ordersApi.js's
 * adminUpdateShippingInfo) — manual entry, no provider call at all.
 */
export const manualLabelProvider = {
  name: 'manual',

  /** @param {import('./labelProvider.js').ShippingAddress} address */
  async validateAddress(address) {
    return { valid: true, suggestions: [], errors: [] };
  },

  async getRates() {
    throw new ShippingProviderNotConfiguredError('Automatic rate quoting (manual provider)');
  },

  async purchaseLabel() {
    throw new ShippingProviderNotConfiguredError('Label purchasing (manual provider)');
  },

  async getLabel() {
    throw new ShippingProviderNotConfiguredError('Label retrieval (manual provider)');
  },

  /** @param {string} trackingNumber */
  async getTracking(trackingNumber) {
    return { status: 'unknown', events: [] };
  },

  async refundLabel() {
    return { refunded: false };
  },
};
