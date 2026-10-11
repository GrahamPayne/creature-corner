/**
 * Pure warnings for a gallery item — same "warn, never block" spirit as
 * admin/readiness.js's product readiness model, just much smaller: a
 * gallery item has no commerce fields, so there's nothing to block on.
 */

/**
 * @param {{storagePath?: string|null, altText?: string|null}} item
 * @returns {string[]}
 */
export function getGalleryItemWarnings(item) {
  const warnings = [];
  if (!item.storagePath) warnings.push('Image missing');
  if (!item.altText?.trim()) warnings.push('Alt text missing');
  return warnings;
}
