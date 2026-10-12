import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseClient } from '../../../src/features/shop/api/supabaseClient.js';

// Live integration tests against the real, connected Supabase project (see
// docs/SHOP_SETUP.md), same style as products.test.mjs/rls-security.test.mjs.
// These depend on supabase/migrations/003_gallery.sql having been run —
// until it has, gallery_items doesn't exist yet, so every test here skips
// itself with a clear reason instead of failing the whole suite. Section-
// aware behavior (ordering, public filtering by section) is covered in
// gallery-sections.test.mjs, which depends on 004_gallery_sections.sql
// instead — these tests only cover the table/bucket itself.

const supabase = getSupabaseClient();

/** True once the 003_gallery.sql migration has actually been applied. */
async function migrationApplied() {
  const { error } = await supabase.from('gallery_items').select('id').limit(1);
  // PostgREST returns PGRST205 ("table not in schema cache") when the
  // table doesn't exist yet — it never gets as far as Postgres's own
  // 42P01 "relation does not exist" for a table it's never seen.
  return !(error && error.code === 'PGRST205');
}

test('unauthenticated client can read visible gallery_items rows', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/003_gallery.sql has not been run yet');
    return;
  }
  const { data, error } = await supabase.from('gallery_items').select('id, storage_path').eq('visible', true);
  assert.equal(error, null);
  assert.ok(Array.isArray(data));
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
  const { data: rows } = await supabase.from('gallery_items').select('id, visible').eq('visible', true).limit(1);
  if (!rows || rows.length === 0) {
    t.skip('no gallery items exist yet to test a write against');
    return;
  }
  const target = rows[0];

  await supabase.from('gallery_items').update({ visible: false }).eq('id', target.id);
  await supabase.from('gallery_items').delete().eq('id', target.id);

  const { data: after } = await supabase.from('gallery_items').select('id, visible').eq('id', target.id).maybeSingle();
  assert.ok(after, 'gallery item was deleted by an unauthenticated client');
  assert.equal(after.visible, true, 'gallery item visibility was changed by an unauthenticated client');
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
