import { manualLabelProvider } from './manualLabelProvider.js';
import { easypostLabelProvider } from './providers/easypostLabelProvider.js';
import { shippoLabelProvider } from './providers/shippoLabelProvider.js';

/** Every registered ShippingLabelProvider, keyed by its `name`. */
export const SHIPPING_LABEL_PROVIDERS = {
  manual: manualLabelProvider,
  easypost: easypostLabelProvider,
  shippo: shippoLabelProvider,
};

/** @param {string} name @returns {import('./labelProvider.js').ShippingLabelProvider} */
export function getShippingLabelProvider(name) {
  const provider = SHIPPING_LABEL_PROVIDERS[name];
  if (!provider) throw new Error(`Unknown shipping label provider "${name}"`);
  return provider;
}
