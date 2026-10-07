import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseClient } from '../../../src/features/shop/api/supabaseClient.js';
import { getProducts } from '../../../src/features/shop/api/products.js';

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
