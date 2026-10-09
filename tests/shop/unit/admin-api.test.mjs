import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDbPatch } from '../../../src/features/shop/admin/api.js';

test('toDbPatch maps every camelCase product field to its snake_case column', () => {
  const patch = toDbPatch({
    name: 'Mask',
    slug: 'mask',
    priceCents: 1000,
    shortDescription: 'short',
    description: 'long',
    categoryId: 'cat-1',
    dimensions: '1x1',
    materials: 'resin',
    quantity: 2,
    shippingClass: 'small',
    pickupAvailable: true,
    packedWeightLb: 1,
    packedWeightOz: 8,
    packageLengthIn: 10,
    packageWidthIn: 8,
    packageHeightIn: 6,
    featured: false,
    status: 'draft',
  });

  assert.deepEqual(patch, {
    name: 'Mask',
    slug: 'mask',
    price_cents: 1000,
    short_description: 'short',
    description: 'long',
    category_id: 'cat-1',
    dimensions: '1x1',
    materials: 'resin',
    quantity: 2,
    shipping_class: 'small',
    pickup_available: true,
    packed_weight_lb: 1,
    packed_weight_oz: 8,
    package_length_in: 10,
    package_width_in: 8,
    package_height_in: 6,
    featured: false,
    status: 'draft',
  });
});

test('toDbPatch only includes keys that were actually provided (partial patch support)', () => {
  assert.deepEqual(toDbPatch({ status: 'sold' }), { status: 'sold' });
  assert.deepEqual(toDbPatch({ featured: true }), { featured: true });
  assert.deepEqual(toDbPatch({}), {});
});

test('toDbPatch ignores unknown keys rather than passing them through', () => {
  assert.deepEqual(toDbPatch({ notARealField: 'x', status: 'available' }), { status: 'available' });
});
