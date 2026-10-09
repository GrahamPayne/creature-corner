import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReadinessChecks, getReadinessStatus, getBlockingIssues, canPublish } from '../../../src/features/shop/admin/readiness.js';

const RATES = { small: 500, medium: 900, large: 1500, oversized: null };

/** A fully-complete, shippable+pickup product — the "everything checks out" baseline each test perturbs. */
const COMPLETE = {
  status: 'available',
  priceCents: 2000,
  categoryId: 'cat-1',
  quantity: 1,
  shippingClass: 'medium',
  pickupAvailable: true,
  images: [{ url: 'https://example.com/a.webp', isPrimary: true }],
  shortDescription: 'A thing',
  description: 'A longer description of the thing.',
  materials: 'Resin',
  dimensions: '4in x 4in',
  packedWeightLb: 1,
  packedWeightOz: 0,
  packageLengthIn: 6,
  packageWidthIn: 6,
  packageHeightIn: 6,
};

function checkFor(checks, key) {
  return checks.find((c) => c.key === key);
}

test('computeReadinessChecks: a fully complete product has every check passing', () => {
  const checks = computeReadinessChecks(COMPLETE, { shippingRates: RATES });
  assert.ok(checks.every((c) => c.ok), `expected all checks to pass: ${JSON.stringify(checks.filter((c) => !c.ok))}`);
});

test('computeReadinessChecks: missing image is a warning, not blocking', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, images: [] }, { shippingRates: RATES });
  const imageCheck = checkFor(checks, 'image');
  assert.equal(imageCheck.ok, false);
  assert.equal(imageCheck.severity, 'warning');
});

test('computeReadinessChecks: imageCount is accepted as an alternative to images[] (form-draft shape)', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, images: undefined, imageCount: 2 }, { shippingRates: RATES });
  assert.equal(checkFor(checks, 'image').ok, true);
});

test('computeReadinessChecks: missing short/full description, materials, dimensions are all warnings', () => {
  const checks = computeReadinessChecks(
    { ...COMPLETE, shortDescription: '', description: '', materials: '', dimensions: '' },
    { shippingRates: RATES }
  );
  for (const key of ['shortDescription', 'description', 'materials', 'dimensions']) {
    const c = checkFor(checks, key);
    assert.equal(c.ok, false, `${key} should be flagged`);
    assert.equal(c.severity, 'warning', `${key} should be a warning, not blocking`);
  }
});

test('computeReadinessChecks: packed weight/dimensions only checked when fulfillment mode requires them', () => {
  // ship_and_pickup (medium + pickupAvailable) requires packed data.
  const missingPacked = computeReadinessChecks(
    { ...COMPLETE, packedWeightLb: 0, packedWeightOz: 0, packageLengthIn: null, packageWidthIn: null, packageHeightIn: null },
    { shippingRates: RATES }
  );
  assert.equal(checkFor(missingPacked, 'packedWeight').ok, false);
  assert.equal(checkFor(missingPacked, 'packedDimensions').ok, false);
  assert.equal(checkFor(missingPacked, 'packedWeight').severity, 'warning');

  // pickup_only never needs packed data — the checks shouldn't even appear.
  const pickupOnly = computeReadinessChecks({ ...COMPLETE, shippingClass: 'pickup_only' }, { shippingRates: RATES });
  assert.equal(checkFor(pickupOnly, 'packedWeight'), undefined);
  assert.equal(checkFor(pickupOnly, 'packedDimensions'), undefined);
});

test('computeReadinessChecks: blocking checks — price, category, quantity', () => {
  assert.equal(checkFor(computeReadinessChecks({ ...COMPLETE, priceCents: 0 }, { shippingRates: RATES }), 'price').ok, false);
  assert.equal(checkFor(computeReadinessChecks({ ...COMPLETE, priceCents: 0 }, { shippingRates: RATES }), 'price').severity, 'blocking');
  assert.equal(checkFor(computeReadinessChecks({ ...COMPLETE, categoryId: null }, { shippingRates: RATES }), 'category').ok, false);
  assert.equal(checkFor(computeReadinessChecks({ ...COMPLETE, quantity: 0 }, { shippingRates: RATES }), 'quantity').ok, false);
});

test('computeReadinessChecks: category check also accepts a nested category object (loaded-product shape)', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, categoryId: undefined, category: { id: 'cat-2', name: 'Masks' } }, { shippingRates: RATES });
  assert.equal(checkFor(checks, 'category').ok, true);
});

test('computeReadinessChecks: shipping — a size class with no configured rate and no pickup is blocking', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, shippingClass: 'oversized', pickupAvailable: false }, { shippingRates: RATES });
  assert.equal(checkFor(checks, 'shipping').ok, false);
  assert.equal(checkFor(checks, 'shipping').severity, 'blocking');
});

test('computeReadinessChecks: shipping — a size class with no configured rate but pickup enabled is still usable', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, shippingClass: 'oversized', pickupAvailable: true }, { shippingRates: RATES });
  assert.equal(checkFor(checks, 'shipping').ok, true);
});

test('computeReadinessChecks: shipping — a configured rate is usable even with pickup disabled', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, shippingClass: 'small', pickupAvailable: false }, { shippingRates: RATES });
  assert.equal(checkFor(checks, 'shipping').ok, true);
});

test('computeReadinessChecks: shipping — pickup_only and special_quote are always usable regardless of rates', () => {
  assert.equal(checkFor(computeReadinessChecks({ ...COMPLETE, shippingClass: 'pickup_only' }, { shippingRates: {} }), 'shipping').ok, true);
  assert.equal(checkFor(computeReadinessChecks({ ...COMPLETE, shippingClass: 'special_quote' }, { shippingRates: {} }), 'shipping').ok, true);
});

test('getReadinessStatus: draft status always reports "draft", regardless of how complete the product is', () => {
  assert.equal(getReadinessStatus({ status: 'draft' }, computeReadinessChecks({ ...COMPLETE, status: 'draft', priceCents: 0 }, { shippingRates: RATES })), 'draft');
  assert.equal(getReadinessStatus({ status: 'draft' }, computeReadinessChecks({ ...COMPLETE, status: 'draft' }, { shippingRates: RATES })), 'draft');
});

test('getReadinessStatus: non-draft with all checks passing is "ready"', () => {
  const checks = computeReadinessChecks(COMPLETE, { shippingRates: RATES });
  assert.equal(getReadinessStatus(COMPLETE, checks), 'ready');
});

test('getReadinessStatus: non-draft with any failing check (even a warning) is "needs_info"', () => {
  const incomplete = { ...COMPLETE, materials: '' };
  const checks = computeReadinessChecks(incomplete, { shippingRates: RATES });
  assert.equal(getReadinessStatus(incomplete, checks), 'needs_info');
});

test('getBlockingIssues only returns blocking, unmet checks', () => {
  const checks = computeReadinessChecks({ ...COMPLETE, priceCents: 0, materials: '' }, { shippingRates: RATES });
  const blocking = getBlockingIssues(checks);
  assert.deepEqual(blocking.map((c) => c.key), ['price']);
});

test('canPublish: true for a fully complete product, false when a blocking field is invalid', () => {
  assert.equal(canPublish(COMPLETE, { shippingRates: RATES }), true);
  assert.equal(canPublish({ ...COMPLETE, quantity: 0 }, { shippingRates: RATES }), false);
});

test('canPublish: never blocked by warning-only fields — a product with no photo can still publish if commerce fields are valid', () => {
  assert.equal(canPublish({ ...COMPLETE, images: [], shortDescription: '', description: '', materials: '', dimensions: '' }, { shippingRates: RATES }), true);
});
