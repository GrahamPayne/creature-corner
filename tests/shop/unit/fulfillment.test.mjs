import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveFulfillmentMode,
  fulfillmentNeedsPackageSize,
  fulfillmentRequiresPackedData,
  resolveFulfillment,
  validatePackedShipping,
} from '../../../src/features/shop/admin/fulfillment.js';

// deriveFulfillmentMode — must round-trip with resolveFulfillment, since
// that's what makes loading an existing product into the Edit form show
// the correct mode without a new "fulfillment mode" column existing.

test('deriveFulfillmentMode: shippable + pickup-enabled product is "ship_and_pickup"', () => {
  assert.equal(deriveFulfillmentMode({ shippingClass: 'medium', pickupAvailable: true }), 'ship_and_pickup');
});

test('deriveFulfillmentMode: shippable + pickup-disabled product is "ship_only"', () => {
  assert.equal(deriveFulfillmentMode({ shippingClass: 'small', pickupAvailable: false }), 'ship_only');
});

test('deriveFulfillmentMode: pickup_only shipping class wins regardless of the pickupAvailable flag', () => {
  assert.equal(deriveFulfillmentMode({ shippingClass: 'pickup_only', pickupAvailable: true }), 'pickup_only');
});

test('deriveFulfillmentMode: special_quote shipping class is its own mode', () => {
  assert.equal(deriveFulfillmentMode({ shippingClass: 'special_quote', pickupAvailable: false }), 'special_quote');
});

test('deriveFulfillmentMode: a brand-new (undefined) product defaults to ship_only', () => {
  assert.equal(deriveFulfillmentMode(undefined), 'ship_only');
});

test('resolveFulfillment round-trips with deriveFulfillmentMode for all four modes', () => {
  const cases = [
    { shippingClass: 'medium', pickupAvailable: true },
    { shippingClass: 'large', pickupAvailable: false },
    { shippingClass: 'pickup_only', pickupAvailable: true },
    { shippingClass: 'special_quote', pickupAvailable: false },
  ];
  for (const original of cases) {
    const mode = deriveFulfillmentMode(original);
    const resolved = resolveFulfillment(mode, original.shippingClass);
    assert.deepEqual(resolved, original, `round-trip failed for mode "${mode}"`);
  }
});

test('resolveFulfillment throws on an unknown mode rather than silently defaulting', () => {
  assert.throws(() => resolveFulfillment('not-a-real-mode', 'medium'));
});

test('fulfillmentNeedsPackageSize is true only for the two "ships" modes', () => {
  assert.equal(fulfillmentNeedsPackageSize('ship_and_pickup'), true);
  assert.equal(fulfillmentNeedsPackageSize('ship_only'), true);
  assert.equal(fulfillmentNeedsPackageSize('pickup_only'), false);
  assert.equal(fulfillmentNeedsPackageSize('special_quote'), false);
});

test('fulfillmentRequiresPackedData matches fulfillmentNeedsPackageSize', () => {
  assert.equal(fulfillmentRequiresPackedData('ship_and_pickup'), true);
  assert.equal(fulfillmentRequiresPackedData('pickup_only'), false);
  assert.equal(fulfillmentRequiresPackedData('special_quote'), false);
});

// validatePackedShipping

const VALID_PACKED = { packedWeightLb: 2, packedWeightOz: 4, packageLengthIn: 10, packageWidthIn: 8, packageHeightIn: 6 };

test('validatePackedShipping: valid packed data with requirePositive passes', () => {
  assert.equal(validatePackedShipping(VALID_PACKED, { requirePositive: true }), null);
});

test('validatePackedShipping: negative weight is rejected', () => {
  assert.ok(validatePackedShipping({ ...VALID_PACKED, packedWeightLb: -1 }, { requirePositive: false }));
});

test('validatePackedShipping: negative dimension is rejected even when not required', () => {
  assert.ok(validatePackedShipping({ ...VALID_PACKED, packageLengthIn: -1 }, { requirePositive: false }));
});

test('validatePackedShipping: ounces must be 0-15', () => {
  assert.ok(validatePackedShipping({ ...VALID_PACKED, packedWeightOz: 16 }, { requirePositive: false }));
  assert.equal(validatePackedShipping({ ...VALID_PACKED, packedWeightOz: 15 }, { requirePositive: false }), null);
});

test('validatePackedShipping: pickup-only (requirePositive=false) never requires dimensions or weight', () => {
  assert.equal(
    validatePackedShipping({ packedWeightLb: 0, packedWeightOz: 0, packageLengthIn: null, packageWidthIn: null, packageHeightIn: null }, { requirePositive: false }),
    null
  );
});

test('validatePackedShipping: shippable product (requirePositive=true) with missing dimensions is rejected', () => {
  assert.ok(
    validatePackedShipping({ packedWeightLb: 1, packedWeightOz: 0, packageLengthIn: null, packageWidthIn: 8, packageHeightIn: 6 }, { requirePositive: true })
  );
});

test('validatePackedShipping: shippable product with zero total weight is rejected', () => {
  assert.ok(
    validatePackedShipping({ packedWeightLb: 0, packedWeightOz: 0, packageLengthIn: 10, packageWidthIn: 8, packageHeightIn: 6 }, { requirePositive: true })
  );
});
