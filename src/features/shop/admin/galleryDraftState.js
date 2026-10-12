/**
 * Pure state management for the Gallery admin's per-card drafts — no DOM,
 * no network. This is where the Gallery-v1 data-loss bug actually lived:
 * every admin action ended by rebuilding every card's HTML straight from
 * the server-confirmed item list, which silently discarded whatever was
 * still typed (unsaved) into every *other* card's inputs. The fix is
 * this module: a draft, once created for a card, is only ever read or
 * replaced by that card's own id — never cleared as a side effect of
 * saving, reordering, hiding, featuring, or deleting a different card.
 * admin/galleryManager.js is a thin DOM wrapper around these functions.
 */

export const DRAFT_FIELDS = ['title', 'caption', 'altText', 'gallerySectionId', 'visible', 'featured'];

/** A fresh draft snapshot of an item's last-known-saved fields — the baseline a card's draft starts from before anything is typed. @param {any} item */
export function draftFromItem(item) {
  return {
    title: item.title ?? '',
    caption: item.caption ?? '',
    altText: item.altText ?? '',
    gallerySectionId: item.gallerySectionId ?? null,
    visible: Boolean(item.visible),
    featured: Boolean(item.featured),
  };
}

/** The values a card should render: its draft if one exists, otherwise a fresh snapshot of the item. @param {any} item @param {any} [draft] */
export function effectiveFields(item, draft) {
  return draft || draftFromItem(item);
}

/** True if `draft` differs from the item's last-known-saved state in any tracked field. @param {any} item @param {any} [draft] */
export function isDirty(item, draft) {
  if (!draft) return false;
  const saved = draftFromItem(item);
  return DRAFT_FIELDS.some((field) => saved[field] !== draft[field]);
}

/** Converts a dirty draft into the camelCase patch admin/galleryApi.js's adminUpdateGalleryItem expects. @param {any} draft */
export function buildPatch(draft) {
  return {
    title: draft.title.trim() || null,
    caption: draft.caption.trim() || null,
    altText: draft.altText.trim() || null,
    gallerySectionId: draft.gallerySectionId || null,
    visible: draft.visible,
    featured: draft.featured,
  };
}

/**
 * Applies a successful save to {items, drafts}, touching ONLY the saved
 * item's two entries. Every other id's item/draft comes back as the
 * exact same reference it went in with — this is the property the live
 * bug violated, and the one the regression test checks directly.
 * @param {{items: any[], drafts: Map<string, any>}} state
 * @param {any} savedItem - server response after a successful update
 * @returns {{items: any[], drafts: Map<string, any>}}
 */
export function mergeSavedItem({ items, drafts }, savedItem) {
  const nextItems = items.map((i) => (i.id === savedItem.id ? savedItem : i));
  const nextDrafts = new Map(drafts);
  nextDrafts.delete(savedItem.id);
  return { items: nextItems, drafts: nextDrafts };
}

/** Sets/replaces one item's draft without touching any other entry. @param {Map<string, any>} drafts @param {string} id @param {any} draft */
export function setDraft(drafts, id, draft) {
  const next = new Map(drafts);
  next.set(id, draft);
  return next;
}

/** Removes a draft (e.g. after a delete) without touching any other entry. @param {Map<string, any>} drafts @param {string} id */
export function clearDraft(drafts, id) {
  const next = new Map(drafts);
  next.delete(id);
  return next;
}

/** Ids of every item with unsaved changes, in `items` order — what Save All processes. @param {any[]} items @param {Map<string, any>} drafts */
export function dirtyIds(items, drafts) {
  return items.filter((i) => isDirty(i, drafts.get(i.id))).map((i) => i.id);
}

/** True if any item currently has unsaved changes — the leave-without-saving guard. @param {any[]} items @param {Map<string, any>} drafts */
export function hasAnyDirty(items, drafts) {
  return items.some((i) => isDirty(i, drafts.get(i.id)));
}

/** Items sharing a gallerySectionId (including the null "Unassigned" group), sorted by sortOrder — the universe Move Up/Down operates within. @param {any[]} items @param {string|null} gallerySectionId */
export function sectionSiblings(items, gallerySectionId) {
  return items
    .filter((i) => (i.gallerySectionId ?? null) === (gallerySectionId ?? null))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Computes the new same-section id order after moving `id` up/down by
 * one position. Never includes an id from a different section, so
 * reordering can't scramble another section regardless of which admin
 * filter is currently displayed.
 * @param {any[]} items
 * @param {string} id
 * @param {1|-1} direction
 * @returns {string[]|null} new ordered id list for that section, or null if `id` is already at that edge
 */
export function moveWithinSection(items, id, direction) {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const siblings = sectionSiblings(items, item.gallerySectionId);
  const index = siblings.findIndex((i) => i.id === id);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return null;
  const reordered = siblings.slice();
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered.map((i) => i.id);
}
