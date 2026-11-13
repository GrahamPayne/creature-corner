/**
 * EasyPost label-purchasing provider — NOT CONNECTED. Complements the
 * rate-quoting plan already documented in docs/SHIPPING_ARCHITECTURE.md
 * (same EASYPOST_API_KEY secret); this extends that to the full
 * validate -> rate -> purchase -> track -> refund label lifecycle via
 * EasyPost's Shipment/Label API, called from a Cloudflare Pages Function
 * (e.g. functions/api/shipping/label.js, not written yet) — never the
 * browser, since it needs the secret key.
 */
import { ShippingProviderNotConfiguredError } from '../labelProvider.js';

function notConfigured() {
  throw new ShippingProviderNotConfiguredError('EasyPost');
}

export const easypostLabelProvider = {
  name: 'easypost',
  async validateAddress() { notConfigured(); },
  async getRates() { notConfigured(); },
  async purchaseLabel() { notConfigured(); },
  async getLabel() { notConfigured(); },
  async getTracking() { notConfigured(); },
  async refundLabel() { notConfigured(); },
};
