/**
 * Picks which image represents a product on the shop card and as the main
 * product-detail image: the one flagged primary, or the first by sort
 * order if none is flagged, or null if there are no images at all (callers
 * render the "No Image" placeholder in that case).
 * @param {{url: string, isPrimary: boolean}[]|undefined} images
 */
export function pickPrimaryImage(images) {
  if (!images || images.length === 0) return null;
  return images.find((img) => img.isPrimary) || images[0];
}
