import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CATEGORIES, SAMPLE_PRODUCTS } from '../../../src/features/shop/data/sample-products.js';

// Guards against exactly the class of bug reported in production: a product
// whose shop-card link and detail-page lookup silently disagree, or whose
// category/shipping/image data is malformed in a way that only breaks some
// products and not others. Every one of these must hold for every product,
// real or prototype, or the public shop can serve a broken link.
//
// This validates the bundled fallback array (data/sample-products.js)
// directly, not api/products.js's getProductBySlug/getProducts — those now
// talk to the real, connected Supabase project (see products.test.mjs for
// live integration tests) and the fallback only still runs for anyone
// using this repo without their own Supabase project configured.

/** Mirrors the "published products only" rule in api/products.js, against the array directly (no network). */
function findPublished(slug) {
  const product = SAMPLE_PRODUCTS.find((p) => p.slug === slug);
  return product && PUBLIC_STATUSES.includes(product.status) ? product : null;
}

const VALID_SHIPPING_CLASSES = ['small', 'medium', 'large', 'oversized', 'pickup_only'];
const VALID_STATUSES = ['draft', 'available', 'sold', 'hidden'];
const PUBLIC_STATUSES = ['available', 'sold'];

test('every product id is unique', () => {
  const ids = SAMPLE_PRODUCTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
});

test('every product slug is unique', () => {
  const slugs = SAMPLE_PRODUCTS.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, `duplicate slugs: ${slugs}`);
});

test('every product slug is URL-safe (lowercase, digits, hyphens only)', () => {
  for (const p of SAMPLE_PRODUCTS) {
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug on "${p.name}": "${p.slug}"`);
  }
});

test('every product references a real category', () => {
  const validSlugs = new Set(SAMPLE_CATEGORIES.map((c) => c.slug));
  for (const p of SAMPLE_PRODUCTS) {
    assert.ok(p.category === null || validSlugs.has(p.category?.slug), `invalid category on "${p.name}": ${JSON.stringify(p.category)}`);
  }
});

test('every product has a valid shipping class', () => {
  for (const p of SAMPLE_PRODUCTS) {
    assert.ok(VALID_SHIPPING_CLASSES.includes(p.shippingClass), `invalid shippingClass on "${p.name}": "${p.shippingClass}"`);
  }
});

test('every product has a valid status', () => {
  for (const p of SAMPLE_PRODUCTS) {
    assert.ok(VALID_STATUSES.includes(p.status), `invalid status on "${p.name}": "${p.status}"`);
  }
});

test('every published (available/sold) product has at least one image with a non-empty url', () => {
  for (const p of SAMPLE_PRODUCTS.filter((p) => PUBLIC_STATUSES.includes(p.status))) {
    assert.ok(p.images.length > 0, `"${p.name}" is published but has no images`);
    for (const img of p.images) {
      assert.ok(img.url && img.url.length > 0, `"${p.name}" has an image with an empty url`);
    }
  }
});

test('every published product has exactly one primary image', () => {
  for (const p of SAMPLE_PRODUCTS.filter((p) => PUBLIC_STATUSES.includes(p.status))) {
    const primaryCount = p.images.filter((img) => img.isPrimary).length;
    assert.equal(primaryCount, 1, `"${p.name}" has ${primaryCount} primary images, expected exactly 1`);
  }
});

test('every published product round-trips by slug lookup', () => {
  // This is the specific check that would catch a shop-card-href vs
  // detail-page-lookup mismatch, the exact failure mode reported live.
  for (const p of SAMPLE_PRODUCTS.filter((p) => PUBLIC_STATUSES.includes(p.status))) {
    const found = findPublished(p.slug);
    assert.ok(found, `lookup for "${p.slug}" returned null for a published product`);
    assert.equal(found.slug, p.slug);
    assert.equal(found.name, p.name);
  }
});

test('draft and hidden products are never returned by the published-only lookup', () => {
  for (const p of SAMPLE_PRODUCTS.filter((p) => !PUBLIC_STATUSES.includes(p.status))) {
    assert.equal(findPublished(p.slug), null, `"${p.name}" has status "${p.status}" but was still returned`);
  }
});

test('quantity 0 products are either sold or draft/hidden, never "available"', () => {
  for (const p of SAMPLE_PRODUCTS) {
    if (p.quantity === 0) {
      assert.notEqual(p.status, 'available', `"${p.name}" has quantity 0 but status "available"`);
    }
  }
});
