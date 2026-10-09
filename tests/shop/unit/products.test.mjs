import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategories, getProducts, getProductBySlug } from '../../../src/features/shop/api/products.js';

// Live integration tests against the real, connected Supabase project
// (src/features/shop/api/config.js has real credentials — see
// docs/SHOP_SETUP.md). Products are managed through /admin and can change
// at any time; since Stage 6.5 added category management (add/rename/
// reorder/delete), categories are no longer a fixed closed set either —
// so these deliberately don't assert fixed counts or specific content,
// only the invariants that must always hold regardless of what's
// currently in the table (most importantly, that RLS is doing its job:
// only published products are ever returned here).

test('getCategories returns a non-empty list of well-formed categories, in sort order', async () => {
  const categories = await getCategories();
  assert.ok(categories.length > 0, 'expected at least one category to exist');
  for (const c of categories) {
    assert.ok(c.slug, `category "${c.name}" has no slug`);
    assert.ok(c.name, `category "${c.slug}" has no name`);
  }
  const slugs = categories.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length, `duplicate category slugs: ${slugs}`);
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
