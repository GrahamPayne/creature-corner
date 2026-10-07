/** Pure path helper — no DOM, no network, safe to unit test directly. */

/**
 * Builds a unique Storage object path for an uploaded product image.
 * Never derives the filename from the user's original filename (which could
 * collide, contain unsafe characters, or leak local file info) — just the
 * product id plus a random id, so collisions are effectively impossible.
 * @param {string} productId
 * @param {string} [extension]
 */
export function uniqueImagePath(productId, extension = 'webp') {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `products/${productId}/${id}.${extension}`;
}
