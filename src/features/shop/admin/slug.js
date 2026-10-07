/** Pure slug helpers — no DOM, no network, safe to unit test directly. */

/** @param {string} name */
export function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .trim()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Appends/increments a numeric suffix until `taken(candidate)` returns false.
 * Used both for "suggest a slug from this name" and "find a free slug for a duplicate".
 * @param {string} base
 * @param {(slug: string) => boolean} taken
 */
export function uniqueSlug(base, taken) {
  const root = slugify(base) || 'item';
  if (!taken(root)) return root;
  let n = 2;
  while (taken(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}
