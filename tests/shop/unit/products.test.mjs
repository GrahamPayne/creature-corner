import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategories, getProducts, getProductBySlug } from '../../../src/features/shop/api/products.js';

// Live integration tests against the real, connected Supabase project
// (src/features/shop/api/config.js has real credentials — see
// docs/SHOP_SETUP.md). Categories/shipping classes are stable seed data
// from supabase/schema.sql; products are managed through /admin and can
// change at any time, so these deliberately don't assert fixed counts or
// specific product content — only the invariants that must always hold
// regardless of what's currently in the table (most importantly, that RLS
// is doing its job: only published products are ever returned here).

test('getCategories returns the 5 categories seeded by supabase/schema.sql', async () => {
  const categories = await getCategories();
  assert.equal(categories.length, 5);
  for (const slug of ['original-art', 'plants', 'masks', 'prints', 'small-stuff']) {
    assert.ok(categories.some((c) => c.slug === slug), `missing category "${slug}"`);
  }
});

test('getProducts only ever returns published (available/sold) products', async () => {
  const products = await getProducts();
  assert.ok(Array.isArray(products));
  assert.ok(products.every((p) => p.status === 'available' || p.status === 'sold'));
});

test('getProducts filtering by an unknown category returns an empty array, not an error', async () => {
  const products = await getProducts({ categorySlug: 'does-not-exist' });
  assert.deepEqual(products, []);
});

test('getProducts({categorySlug}) only returns products in that category', async () => {
  const products = await getProducts({ categorySlug: 'masks' });
  assert.ok(products.every((p) => p.category?.slug === 'masks'));
});

test('getProductBySlug returns null for an unknown slug', async () => {
  assert.equal(await getProductBySlug('definitely-does-not-exist-12345'), null);
});

test('every product returned by getProducts round-trips through getProductBySlug', async () => {
  const products = await getProducts();
  for (const p of products.slice(0, 5)) {
    // slice(0,5): enough to catch a systemic bug without making this test's
    // runtime scale with however many real products exist.
    const found = await getProductBySlug(p.slug);
    assert.ok(found, `getProductBySlug("${p.slug}") returned null for a product getProducts() just listed`);
    assert.equal(found.slug, p.slug);
    assert.equal(found.id, p.id);
  }
});
