/**
 * Shipping LABEL provider interface (section H) — a different concern
 * from shipping/shippingProvider.js, which only quotes a flat rate for
 * the cart. This is the future "open an order, pick a rate, buy a label"
 * admin workflow. Same pattern as payments/paymentProvider.js: core order
 * code only ever calls these function names, never a specific carrier API
 * directly, so Shippo/EasyPost/another provider is a drop-in file.
 *
 * Server-side-only, same reasoning as docs/SHIPPING_ARCHITECTURE.md
 * already documents for rate-quoting: a real label provider needs a
 * secret API key and must be called from a Cloudflare Pages Function, not
 * the browser. manualLabelProvider.js is the only implementation usable
 * from the admin UI today — it never purchases anything, it just records
 * what the admin typed in by hand (carrier, service, tracking number).
 *
 * @typedef {Object} PackageInfo
 * @property {number} weightOz
 * @property {number} lengthIn
 * @property {number} widthIn
 * @property {number} heightIn
 *
 * @typedef {Object} ShippingAddress
 * @property {string} name
 * @property {string} line1
 * @property {string} [line2]
 * @property {string} city
 * @property {string} state
 * @property {string} zip
 * @property {string} country
 *
 * @typedef {Object} CarrierRate
 * @property {string} carrier
 * @property {string} service
 * @property {number} amountCents
 * @property {string} [estimatedDelivery]
 * @property {string} rateId - provider-specific id to pass back into purchaseLabel
 *
 * @typedef {Object} PurchasedLabel
 * @property {string} carrier
 * @property {string} service
 * @property {string} trackingNumber
 * @property {string} labelReference - provider-specific id, used to fetch/refund the label later
 * @property {string} [labelUrl] - where to view/download/print the label, once a real provider supplies one
 *
 * @typedef {Object} ShippingLabelProvider
 * @property {string} name
 * @property {(address: ShippingAddress) => Promise<{valid: boolean, suggestions?: ShippingAddress[], errors?: string[]}>} validateAddress
 * @property {(opts: {fromAddress: ShippingAddress, toAddress: ShippingAddress, packageInfo: PackageInfo}) => Promise<CarrierRate[]>} getRates
 *   Must only ever return rates actually quoted by the provider — never invent a price (see "Do not create fake carrier quotes" in the spec).
 * @property {(rateId: string) => Promise<PurchasedLabel>} purchaseLabel
 * @property {(labelReference: string) => Promise<PurchasedLabel>} getLabel
 * @property {(trackingNumber: string) => Promise<{status: string, events: {description: string, timestamp: string}[]}>} getTracking
 * @property {(labelReference: string) => Promise<{refunded: boolean}>} refundLabel
 */

export const SHIPPING_LABEL_PROVIDER_CONTRACT = ['name', 'validateAddress', 'getRates', 'purchaseLabel', 'getLabel', 'getTracking', 'refundLabel'];

/** @param {any} provider @returns {boolean} */
export function implementsShippingLabelProviderContract(provider) {
  return SHIPPING_LABEL_PROVIDER_CONTRACT.every((key) => key in provider);
}

export class ShippingProviderNotConfiguredError extends Error {
  constructor(providerName) {
    super(`${providerName} is not configured yet — this phase builds the integration boundary only (see docs/ORDERS_FULFILLMENT_ARCHITECTURE.md). No live label purchasing is connected.`);
    this.name = 'ShippingProviderNotConfiguredError';
  }
}
