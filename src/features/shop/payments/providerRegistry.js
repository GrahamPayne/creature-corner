import { testProvider } from './providers/testProvider.js';
import { stripeProvider } from './providers/stripeProvider.js';
import { paypalProvider } from './providers/paypalProvider.js';

/** Every registered PaymentProvider, keyed by its `name`. Square can be added the same way later — a new providers/squareProvider.js file plus one line here, nothing else in the order system changes. */
export const PAYMENT_PROVIDERS = {
  test: testProvider,
  stripe: stripeProvider,
  paypal: paypalProvider,
};

/** @param {string} name @returns {import('./paymentProvider.js').PaymentProvider} */
export function getPaymentProvider(name) {
  const provider = PAYMENT_PROVIDERS[name];
  if (!provider) throw new Error(`Unknown payment provider "${name}"`);
  return provider;
}
