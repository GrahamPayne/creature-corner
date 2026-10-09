import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseClient } from '../../../src/features/shop/api/supabaseClient.js';
import { getProducts, getCategories } from '../../../src/features/shop/api/products.js';

// Live security tests against the real, connected Supabase project, using
// the public anon/publishable client with NO admin session — exactly what
// an attacker calling the API directly would have. These prove the actual
// enforcement (RLS policies in supabase/schema.sql), not just that the
// admin UI hides the buttons. See docs/SHOP_SETUP.md.

const supabase = getSupabaseClient();

test('unauthenticated client cannot read the admins table', async () => {
  const { data, error } = await supabase.from('admins').select('*');
  // `admins` has no grant at all for anon/authenticated (see schema.sql),
  // so this is denied at the Postgres privilege layer before RLS even
  // runs — a permission-denied error, not just an empty result.
  assert.ok(error, 'expected a permission error but the read succeeded');
  assert.equal(data, null);
});

test('is_admin() RPC returns false with no session', async () => {
  const { data, error } = await supabase.rpc('is_admin');
  assert.equal(error, null);
  assert.equal(data, false);
});

test('unauthenticated client cannot insert a product', async () => {
  const { error } = await supabase.from('products').insert({
    name: 'RLS Test Intruder Product',
    slug: `rls-test-intruder-${Date.now()}`,
    price_cents: 100,
    status: 'available',
  });
  assert.ok(error, 'expected an RLS error but the insert succeeded');
});

test('unauthenticated client cannot change an existing product\'s price or status', async (t) => {
  const products = await getProducts();
  if (products.length === 0) {
    t.skip('no published products exist yet to test an update against — run supabase/seed-sample-products.sql or add one via /admin');
    return;
  }
  const target = products[0];

  await supabase.from('products').update({ price_cents: 1, status: 'sold' }).eq('id', target.id);

  // RLS makes this UPDATE match zero rows for the anon role rather than
  // erroring — the only way to prove nothing changed is to re-read it.
  const after = await getProducts();
  const unchanged = after.find((p) => p.id === target.id);
  assert.ok(unchanged, 'product disappeared entirely, which would also be a bug');
  assert.equal(unchanged.priceCents, target.priceCents);
  assert.equal(unchanged.status, target.status);
});

test('unauthenticated client cannot delete a product', async (t) => {
  const products = await getProducts();
  if (products.length === 0) {
    t.skip('no published products exist yet to test a delete against — run supabase/seed-sample-products.sql or add one via /admin');
    return;
  }
  const target = products[0];

  await supabase.from('products').delete().eq('id', target.id);

  const after = await getProducts();
  assert.ok(after.some((p) => p.id === target.id), 'product was deleted by an unauthenticated client');
});

test('unauthenticated client can list the product-images bucket (public read)', async () => {
  const { error } = await supabase.storage.from('product-images').list();
  assert.equal(error, null);
});

test('unauthenticated client cannot upload to the product-images bucket', async () => {
  const blob = new Blob(['not a real image'], { type: 'image/webp' });
  const { error } = await supabase.storage
    .from('product-images')
    .upload(`products/rls-test/${Date.now()}.webp`, blob);
  assert.ok(error, 'expected an RLS error but the upload succeeded');
});

test('unauthenticated client cannot insert a category', async () => {
  const { error } = await supabase.from('categories').insert({ slug: `rls-test-${Date.now()}`, name: 'RLS Test Category' });
  assert.ok(error, 'expected an RLS error but the insert succeeded');
});

test('unauthenticated client cannot rename an existing category (Stage 6.5 category management)', async (t) => {
  const categories = await getCategories();
  if (categories.length === 0) {
    t.skip('no categories exist to test a rename against');
    return;
  }
  const target = categories[0];

  await supabase.from('categories').update({ name: 'RLS Test Intruder Rename' }).eq('slug', target.slug);

  const after = await getCategories();
  const unchanged = after.find((c) => c.slug === target.slug);
  assert.ok(unchanged, 'category disappeared entirely, which would also be a bug');
  assert.equal(unchanged.name, target.name);
});

test('unauthenticated client cannot delete a category', async (t) => {
  const categories = await getCategories();
  if (categories.length === 0) {
    t.skip('no categories exist to test a delete against');
    return;
  }
  const target = categories[0];

  await supabase.from('categories').delete().eq('slug', target.slug);

  const after = await getCategories();
  assert.ok(after.some((c) => c.slug === target.slug), 'category was deleted by an unauthenticated client');
});

test('unauthenticated client cannot insert a product_images row', async (t) => {
  const products = await getProducts();
  if (products.length === 0) {
    t.skip('no published products exist yet to attach a test image row to — run supabase/seed-sample-products.sql or add one via /admin');
    return;
  }
  const { error } = await supabase.from('product_images').insert({
    product_id: products[0].id,
    storage_path: `products/${products[0].id}/rls-test-${Date.now()}.webp`,
    sort_order: 999,
    is_primary: false,
  });
  assert.ok(error, 'expected an RLS error but the insert succeeded');
});
