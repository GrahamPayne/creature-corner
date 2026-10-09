import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getShippingQuote } from '../../../src/features/shop/shipping/shippingProvider.js';

const RATES = { small: 500, medium: 900, large: 1500, oversized: 4000 };

test('getShippingQuote: pickup is always free and configured, regardless of items', () => {
  const quote = getShippingQuote({ items: [{ shippingClass: 'oversized' }], fulfillment: 'pickup', rateByClass: RATES });
  assert.deepEqual(quote, { cents: 0, configured: true, shippingClass: null, manualQuote: false });
});

test('getShippingQuote: ordinary shipping delegates to the flat-rate calculation unchanged', () => {
  const quote = getShippingQuote({ items: [{ shippingClass: 'small' }, { shippingClass: 'medium' }], fulfillment: 'shipping', rateByClass: RATES });
  assert.deepEqual(quote, { cents: 900, configured: true, shippingClass: 'medium', manualQuote: false });
});

test('getShippingQuote: an unconfigured flat rate is still reported as unconfigured, not manual-quote', () => {
  const quote = getShippingQuote({ items: [{ shippingClass: 'small' }], fulfillment: 'shipping', rateByClass: { ...RATES, small: null } });
  assert.deepEqual(quote, { cents: null, configured: false, shippingClass: 'small', manualQuote: false });
});

test('getShippingQuote: a cart with only a special_quote item requires a manual quote, not free shipping', () => {
  // Regression guard: special_quote isn't in shippingRules.js's SHIP_RANK,
  // so without the explicit manual-quote check this would fall through to
  // "no shippable class" -> {cents: 0, configured: true} (a fake free
  // shipping price), which is exactly what this mode must never do.
  const quote = getShippingQuote({ items: [{ shippingClass: 'special_quote' }], fulfillment: 'shipping', rateByClass: RATES });
  assert.deepEqual(quote, { cents: null, configured: false, shippingClass: 'special_quote', manualQuote: true });
});

test('getShippingQuote: a special_quote item dominates a mixed cart even with other ordinary items', () => {
  const quote = getShippingQuote({
    items: [{ shippingClass: 'small' }, { shippingClass: 'special_quote' }],
    fulfillment: 'shipping',
    rateByClass: RATES,
  });
  assert.equal(quote.manualQuote, true);
  assert.equal(quote.configured, false);
});
