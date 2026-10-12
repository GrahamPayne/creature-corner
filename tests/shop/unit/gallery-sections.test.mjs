import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseClient } from '../../../src/features/shop/api/supabaseClient.js';
import { getGallerySections, getGallerySectionItems, getAllWorkItems } from '../../../src/features/shop/api/gallery.js';
import { getCategories } from '../../../src/features/shop/api/products.js';

// Live integration tests against the real, connected Supabase project (see
// docs/SHOP_SETUP.md), same style as rls-security.test.mjs/products.test.mjs.
// These depend on supabase/migrations/004_gallery_sections.sql having been
// run — until it has, gallery_sections doesn't exist yet, so every test
// here skips itself with a clear reason instead of failing the suite.

const supabase = getSupabaseClient();

/** True once the 004_gallery_sections.sql migration has actually been applied. */
async function migrationApplied() {
  const { error } = await supabase.from('gallery_sections').select('id').limit(1);
  return !(error && error.code === 'PGRST205');
}

test('getGallerySections: every returned section has at least one item and a cover URL, in sort_order', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  const { data: raw, error } = await supabase.from('gallery_sections').select('id, sort_order').eq('visible', true).order('sort_order');
  assert.equal(error, null);

  const sections = await getGallerySections();
  for (const s of sections) {
    assert.ok(s.itemCount > 0, `section "${s.name}" was returned with itemCount 0 — empty sections must be hidden publicly`);
    assert.ok(s.coverUrl, `section "${s.name}" has no cover URL — never show a broken/blank cover`);
  }
  // Ordering among the subset that actually has items must match sort_order.
  const expectedOrder = raw.filter((r) => sections.some((s) => s.id === r.id)).map((r) => r.id);
  assert.deepEqual(sections.map((s) => s.id), expectedOrder);
});

test('getGallerySectionItems: returns null (not a throw) for an unknown slug', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  assert.equal(await getGallerySectionItems('definitely-does-not-exist-xyz-123'), null);
});

test('getGallerySectionItems: returns null for a hidden section (not reachable by direct slug)', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  const { data: hidden } = await supabase.from('gallery_sections').select('slug').eq('visible', false).limit(1);
  if (!hidden || hidden.length === 0) {
    t.skip('no hidden gallery sections exist to test against');
    return;
  }
  assert.equal(await getGallerySectionItems(hidden[0].slug), null);
});

test('getGallerySectionItems: items are the section\'s own visible items, in sort_order', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  const { data: visibleSection } = await supabase.from('gallery_sections').select('id, slug').eq('visible', true).limit(1).maybeSingle();
  if (!visibleSection) {
    t.skip('no visible gallery sections exist yet to test against');
    return;
  }
  const { data: raw } = await supabase
    .from('gallery_items')
    .select('id, sort_order')
    .eq('gallery_section_id', visibleSection.id)
    .eq('visible', true)
    .order('sort_order');

  const result = await getGallerySectionItems(visibleSection.slug);
  assert.ok(result);
  assert.deepEqual(result.items.map((i) => i.id), raw.map((r) => r.id));
});

test('getAllWorkItems: only includes items assigned to a currently-visible section (unassigned and hidden-section items excluded)', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  const { data: visibleSections } = await supabase.from('gallery_sections').select('id').eq('visible', true);
  const visibleIds = (visibleSections || []).map((s) => s.id);

  let expectedCount = 0;
  if (visibleIds.length > 0) {
    const { count } = await supabase
      .from('gallery_items')
      .select('id', { count: 'exact', head: true })
      .eq('visible', true)
      .in('gallery_section_id', visibleIds);
    expectedCount = count || 0;
  }

  const items = await getAllWorkItems();
  assert.equal(items.length, expectedCount);
});

test('unauthenticated client cannot insert a gallery_sections row', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  const { error } = await supabase.from('gallery_sections').insert({ name: 'RLS Test Section', slug: `rls-test-${Date.now()}` });
  assert.ok(error, 'expected an RLS error but the insert succeeded');
});

test('unauthenticated client cannot rename or delete an existing gallery section', async (t) => {
  if (!(await migrationApplied())) {
    t.skip('supabase/migrations/004_gallery_sections.sql has not been run yet');
    return;
  }
  const { data: rows } = await supabase.from('gallery_sections').select('id, name').limit(1);
  if (!rows || rows.length === 0) {
    t.skip('no gallery sections exist yet to test a write against');
    return;
  }
  const target = rows[0];

  await supabase.from('gallery_sections').update({ name: 'RLS Test Intruder Rename' }).eq('id', target.id);
  await supabase.from('gallery_sections').delete().eq('id', target.id);

  const { data: after } = await supabase.from('gallery_sections').select('id, name').eq('id', target.id).maybeSingle();
  assert.ok(after, 'gallery section was deleted by an unauthenticated client');
  assert.equal(after.name, target.name, 'gallery section was renamed by an unauthenticated client');
});

test('shop categories are completely unaffected by Gallery Sections', async () => {
  // Gallery Sections is an entirely separate table (gallery_sections) —
  // this proves the shop's own categories table still works exactly as
  // before, independent of whether 004_gallery_sections.sql has run.
  const categories = await getCategories();
  assert.ok(Array.isArray(categories));
  for (const c of categories) {
    assert.ok(typeof c.slug === 'string' && typeof c.name === 'string');
  }
});
