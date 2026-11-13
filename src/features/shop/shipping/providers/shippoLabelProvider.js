/**
 * Shippo label-purchasing provider — NOT CONNECTED. An alternative to
 * EasyPost (see easypostLabelProvider.js) implementing the exact same
 * ShippingLabelProvider interface — keeping providers interchangeable
 * (section H) means this choice can be made later without touching the
 * admin UI or order system. Would need a SHIPPO_API_KEY Cloudflare Pages
 * secret and a server-side Function calling Shippo's Shipment/Transaction API.
 */
import { ShippingProviderNotConfiguredError } from '../labelProvider.js';

function notConfigured() {
  throw new ShippingProviderNotConfiguredError('Shippo');
}

export const shippoLabelProvider = {
  name: 'shippo',
  async validateAddress() { notConfigured(); },
  async getRates() { notConfigured(); },
  async purchaseLabel() { notConfigured(); },
  async getLabel() { notConfigured(); },
  async getTracking() { notConfigured(); },
  async refundLabel() { notConfigured(); },
};
