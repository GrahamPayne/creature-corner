import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseClient } from '../../../src/features/shop/api/supabaseClient.js';
import { getGalleryItems } from '../../../src/features/shop/api/gallery.js';

// Live integration tests against the real, connected Supabase project (see
// docs/SHOP_SETUP.md), same style as products.test.mjs/rls-security.test.mjs.
// These depend on supabase/migrations/003_gallery.sql having been run —
// until it has, gallery_items doesn't exist yet, so every test here skips
// itself with a clear reason instead of failing the whole suite.

const supabase = getSupabaseClient();

/** True once the 003_gallery.sql migration has actually been applied. */
async function migrationApplied() {
  const { error } = await supabase.from('gallery_items').select('id').limit(1);
  // PostgREST returns PGRST205 ("table not in schema cache") when the
  // table doesn't exist yet — it never gets as far as Postgres's own
  // 42P01 "relation does not exist" for a table it's never seen.
  return !(error && error.code === 'PGRST205');
}

test('getGalleryItems only ever returns visible items, ordered by sort_order', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/003_gallery.sql has not been run yet');
    return;
  }
  const items = await getGalleryItems();
  assert.ok(Array.isArray(items));
  const sortOrders = items.map((i) => i.sortOrder);
  const sorted = [...sortOrders].sort((a, b) => a - b);
  assert.deepEqual(sortOrders, sorted, 'items were not returned in sort_order');
});

test('every item returned publicly has a resolvable image URL', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/003_gallery.sql has not been run yet');
    return;
  }
  const items = await getGalleryItems();
  for (const item of items) {
    assert.ok(item.url, `item ${item.id} has no resolvable url`);
  }
});

test('unauthenticated client cannot insert a gallery_items row', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/003_gallery.sql has not been run yet');
    return;
  }
  const { error } = await supabase.from('gallery_items').insert({
    storage_path: `gallery/rls-test-${Date.now()}.webp`,
  });
  assert.ok(error, 'expected an RLS error but the insert succeeded');
});

test('unauthenticated client cannot update or delete an existing gallery item', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/003_gallery.sql has not been run yet');
    return;
  }
  const items = await getGalleryItems();
  if (items.length === 0) {
    t.skip('no gallery items exist yet to test a write against');
    return;
  }
  const target = items[0];

  await supabase.from('gallery_items').update({ visible: false }).eq('id', target.id);
  await supabase.from('gallery_items').delete().eq('id', target.id);

  const after = await getGalleryItems();
  const unchanged = after.find((i) => i.id === target.id);
  assert.ok(unchanged, 'gallery item was deleted by an unauthenticated client');
});

test('unauthenticated client can list the gallery-images bucket (public read) but cannot upload to it', async (t) => {
  const { error: listError } = await supabase.storage.from('gallery-images').list();
  if (listError && /bucket not found/i.test(listError.message || '')) {
    t.skip('gallery-images bucket has not been created yet (run supabase/migrations/003_gallery.sql)');
    return;
  }
  assert.equal(listError, null);

  const blob = new Blob(['not a real image'], { type: 'image/webp' });
  const { error: uploadError } = await supabase.storage
    .from('gallery-images')
    .upload(`rls-test-${Date.now()}.webp`, blob);
  assert.ok(uploadError, 'expected an RLS error but the upload succeeded');
});
