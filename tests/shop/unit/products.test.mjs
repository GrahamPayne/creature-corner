import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategories, getProducts, getProductBySlug } from '../../../src/features/shop/api/products.js';

// These exercise the sample-data fallback path (api/config.js has placeholder
// Supabase credentials in this environment), which mirrors the real RLS
// behavior: only 'available'/'sold' products are ever publicly visible.

test('getCategories returns the seeded category list', async () => {
  const categories = await getCategories();
  assert.equal(categories.length, 5);
  assert.ok(categories.some((c) => c.slug === 'masks'));
});

test('getProducts only returns published (available/sold) products', async () => {
  const products = await getProducts();
  assert.ok(products.every((p) => p.status === 'available' || p.status === 'sold'));
  assert.ok(!products.some((p) => p.slug === 'unfinished-creature-bust'));
  assert.ok(!products.some((p) => p.slug === 'retired-process-print'));
});

test('getProducts filters by category slug', async () => {
  const products = await getProducts({ categorySlug: 'masks' });
  assert.ok(products.length > 0);
  assert.ok(products.every((p) => p.category?.slug === 'masks'));
});

test('getProductBySlug returns null for draft/hidden and unknown slugs', async () => {
  assert.equal(await getProductBySlug('unfinished-creature-bust'), null);
  assert.equal(await getProductBySlug('retired-process-print'), null);
  assert.equal(await getProductBySlug('does-not-exist'), null);
});

test('getProductBySlug returns a full product for a published slug', async () => {
  const product = await getProductBySlug('larval-mask-no-3');
  assert.ok(product);
  assert.equal(product.name, 'Larval Mask No. 3');
  assert.equal(product.priceCents, 32000);
  assert.ok(product.images.length > 0);
});
