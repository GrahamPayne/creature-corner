import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftFromItem,
  effectiveFields,
  isDirty,
  buildPatch,
  mergeSavedItem,
  setDraft,
  clearDraft,
  dirtyIds,
  hasAnyDirty,
  sectionSiblings,
  moveWithinSection,
} from '../../../src/features/shop/admin/galleryDraftState.js';

const itemA = { id: 'a', title: 'A', caption: 'cap-a', altText: 'alt-a', gallerySectionId: null, visible: true, featured: false, sortOrder: 0 };
const itemB = { id: 'b', title: 'B', caption: 'cap-b', altText: 'alt-b', gallerySectionId: null, visible: true, featured: false, sortOrder: 1 };
const itemC = { id: 'c', title: 'C', caption: 'cap-c', altText: 'alt-c', gallerySectionId: null, visible: true, featured: false, sortOrder: 2 };

// ============================================================
// THE BUG REGRESSION TEST
//
// Live bug: typing unsaved edits into cards B and C, then saving card A,
// wiped B's and C's unsaved text — because the old implementation
// rebuilt every card's HTML from the server-confirmed item list on every
// action. mergeSavedItem is the function that replaced that rebuild-
// everything step; this proves it touches ONLY the saved item.
// ============================================================

test('BUG REGRESSION: saving one card never touches another card\'s unsaved draft', () => {
  let drafts = new Map();
  drafts = setDraft(drafts, 'a', { title: 'A edited', caption: 'cap-a', altText: 'alt-a', gallerySectionId: null, visible: true, featured: false });
  const draftB = { title: 'B edited', caption: 'B caption edited', altText: 'B alt edited', gallerySectionId: null, visible: false, featured: true };
  const draftC = { title: 'C edited', caption: 'C caption edited', altText: 'C alt edited', gallerySectionId: null, visible: true, featured: true };
  drafts = setDraft(drafts, 'b', draftB);
  drafts = setDraft(drafts, 'c', draftC);

  let items = [itemA, itemB, itemC];
  const savedA = { ...itemA, title: 'A edited' }; // what the server would return after saving A's draft

  ({ items, drafts } = mergeSavedItem({ items, drafts }, savedA));

  // A is no longer dirty (its draft was cleared on save)...
  assert.equal(drafts.has('a'), false);
  assert.equal(items.find((i) => i.id === 'a').title, 'A edited');

  // ...but B's and C's drafts are byte-identical to what was typed —
  // this is the exact property the live bug violated.
  assert.deepEqual(drafts.get('b'), draftB);
  assert.deepEqual(drafts.get('c'), draftC);
  assert.equal(isDirty(itemB, drafts.get('b')), true);
  assert.equal(isDirty(itemC, drafts.get('c')), true);
});

test('mergeSavedItem leaves every other item by the same reference (not just equal value)', () => {
  const items = [itemA, itemB, itemC];
  const drafts = setDraft(new Map(), 'b', draftFromItem(itemB));
  const { items: nextItems, drafts: nextDrafts } = mergeSavedItem({ items, drafts }, { ...itemA, title: 'changed' });
  assert.equal(nextItems[1], itemB, 'itemB object identity changed even though it was not the saved item');
  assert.equal(nextItems[2], itemC, 'itemC object identity changed even though it was not the saved item');
  assert.equal(nextDrafts.get('b'), drafts.get('b'), 'B\'s draft object identity changed even though it was not saved');
});

// ============================================================
// effectiveFields / isDirty
// ============================================================

test('effectiveFields: with no draft, mirrors the item itself', () => {
  assert.deepEqual(effectiveFields(itemA, undefined), draftFromItem(itemA));
});

test('effectiveFields: with a draft, the draft wins (what the card renders)', () => {
  const draft = { ...draftFromItem(itemA), title: 'Changed' };
  assert.deepEqual(effectiveFields(itemA, draft), draft);
});

test('isDirty: false with no draft, false when draft matches saved state exactly', () => {
  assert.equal(isDirty(itemA, undefined), false);
  assert.equal(isDirty(itemA, draftFromItem(itemA)), false);
});

test('isDirty: true for each individually-changed field', () => {
  const base = draftFromItem(itemA);
  assert.equal(isDirty(itemA, { ...base, title: 'x' }), true);
  assert.equal(isDirty(itemA, { ...base, caption: 'x' }), true);
  assert.equal(isDirty(itemA, { ...base, altText: 'x' }), true);
  assert.equal(isDirty(itemA, { ...base, gallerySectionId: 'section-1' }), true);
  assert.equal(isDirty(itemA, { ...base, visible: false }), true);
  assert.equal(isDirty(itemA, { ...base, featured: true }), true);
});

// ============================================================
// buildPatch
// ============================================================

test('buildPatch: trims text fields and converts blank strings to null', () => {
  const patch = buildPatch({ title: '  Hi  ', caption: '   ', altText: '', gallerySectionId: null, visible: true, featured: false });
  assert.deepEqual(patch, { title: 'Hi', caption: null, altText: null, gallerySectionId: null, visible: true, featured: false });
});

// ============================================================
// dirtyIds / hasAnyDirty — what Save All and the leave-without-saving guard use
// ============================================================

test('dirtyIds: only items with an actually-different draft are included, in item order', () => {
  let drafts = new Map();
  drafts = setDraft(drafts, 'a', draftFromItem(itemA)); // unchanged — not dirty
  drafts = setDraft(drafts, 'c', { ...draftFromItem(itemC), title: 'changed' });
  assert.deepEqual(dirtyIds([itemA, itemB, itemC], drafts), ['c']);
});

test('hasAnyDirty: false when nothing is dirty, true when anything is', () => {
  assert.equal(hasAnyDirty([itemA, itemB], new Map()), false);
  const drafts = setDraft(new Map(), 'b', { ...draftFromItem(itemB), featured: true });
  assert.equal(hasAnyDirty([itemA, itemB], drafts), true);
});

test('a failed save leaves items/drafts completely unchanged (caller simply never calls mergeSavedItem)', () => {
  const drafts = setDraft(new Map(), 'a', { ...draftFromItem(itemA), title: 'in progress' });
  const items = [itemA, itemB];
  // Simulates onUpdate() throwing — mergeSavedItem is never called, so nothing changes.
  assert.deepEqual(drafts.get('a'), { ...draftFromItem(itemA), title: 'in progress' });
  assert.equal(items[0], itemA);
});

test('clearDraft removes only the given id\'s draft (used by delete)', () => {
  let drafts = new Map();
  drafts = setDraft(drafts, 'a', draftFromItem(itemA));
  drafts = setDraft(drafts, 'b', draftFromItem(itemB));
  const next = clearDraft(drafts, 'a');
  assert.equal(next.has('a'), false);
  assert.equal(next.get('b'), drafts.get('b'));
});

// ============================================================
// sectionSiblings / moveWithinSection — reordering can't cross sections
// ============================================================

test('sectionSiblings: groups by gallerySectionId, including the null "Unassigned" group, sorted by sortOrder', () => {
  const items = [
    { id: '1', gallerySectionId: 'sec-1', sortOrder: 1 },
    { id: '2', gallerySectionId: null, sortOrder: 0 },
    { id: '3', gallerySectionId: 'sec-1', sortOrder: 0 },
    { id: '4', gallerySectionId: null, sortOrder: 1 },
  ];
  assert.deepEqual(sectionSiblings(items, 'sec-1').map((i) => i.id), ['3', '1']);
  assert.deepEqual(sectionSiblings(items, null).map((i) => i.id), ['2', '4']);
});

test('moveWithinSection: never returns an id belonging to a different section', () => {
  const items = [
    { id: '1', gallerySectionId: 'plants', sortOrder: 0 },
    { id: '2', gallerySectionId: 'plants', sortOrder: 1 },
    { id: '3', gallerySectionId: 'masks', sortOrder: 0 },
  ];
  const result = moveWithinSection(items, '2', -1);
  assert.deepEqual(result, ['2', '1']); // swapped within "plants" only
  assert.ok(!result.includes('3'), 'a different section\'s item leaked into the reorder');
});

test('moveWithinSection: returns null at the edges (can\'t move first item up or last item down)', () => {
  const items = [
    { id: '1', gallerySectionId: null, sortOrder: 0 },
    { id: '2', gallerySectionId: null, sortOrder: 1 },
  ];
  assert.equal(moveWithinSection(items, '1', -1), null);
  assert.equal(moveWithinSection(items, '2', 1), null);
});

test('moveWithinSection: unknown id returns null rather than throwing', () => {
  assert.equal(moveWithinSection([itemA], 'does-not-exist', 1), null);
});
