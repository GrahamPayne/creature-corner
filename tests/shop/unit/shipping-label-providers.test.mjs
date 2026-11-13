import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementsShippingLabelProviderContract, ShippingProviderNotConfiguredError } from '../../../src/features/shop/shipping/labelProvider.js';
import { manualLabelProvider } from '../../../src/features/shop/shipping/manualLabelProvider.js';
import { easypostLabelProvider } from '../../../src/features/shop/shipping/providers/easypostLabelProvider.js';
import { shippoLabelProvider } from '../../../src/features/shop/shipping/providers/shippoLabelProvider.js';
import { getShippingLabelProvider, SHIPPING_LABEL_PROVIDERS } from '../../../src/features/shop/shipping/labelProviderRegistry.js';

test('every registered shipping label provider implements the full interface', () => {
  for (const [name, provider] of Object.entries(SHIPPING_LABEL_PROVIDERS)) {
    assert.equal(implementsShippingLabelProviderContract(provider), true, `${name} is missing part of the ShippingLabelProvider interface`);
  }
});

test('getShippingLabelProvider returns by name, throws for unknown', () => {
  assert.equal(getShippingLabelProvider('manual'), manualLabelProvider);
  assert.throws(() => getShippingLabelProvider('ups-direct'));
});

test('manualLabelProvider never purchases a label or invents a rate', async () => {
  await assert.rejects(() => manualLabelProvider.getRates(), ShippingProviderNotConfiguredError);
  await assert.rejects(() => manualLabelProvider.purchaseLabel(), ShippingProviderNotConfiguredError);
  await assert.rejects(() => manualLabelProvider.getLabel(), ShippingProviderNotConfiguredError);
});

test('manualLabelProvider.validateAddress is an honest no-op (nothing to validate without a real carrier)', async () => {
  const result = await manualLabelProvider.validateAddress({ name: 'A', line1: '1 Main St', city: 'X', state: 'CA', zip: '00000', country: 'US' });
  assert.equal(result.valid, true);
});

test('easypost and shippo label providers are not configured yet', async () => {
  for (const provider of [easypostLabelProvider, shippoLabelProvider]) {
    await assert.rejects(() => provider.getRates(), ShippingProviderNotConfiguredError);
    await assert.rejects(() => provider.purchaseLabel(), ShippingProviderNotConfiguredError);
  }
});
