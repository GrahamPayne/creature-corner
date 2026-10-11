/**
 * PROTOTYPE GALLERY DATA — placeholder only, used until a real Supabase
 * project is connected (see docs/SHOP_SETUP.md). Reuses the same bundled
 * gallery photography sample-products.js already references. Mirrors the
 * shape api/gallery.js produces from real gallery_items rows, so swapping
 * the data source requires no UI code changes.
 */

/** @typedef {import('../types/typedefs.js').GalleryItem} GalleryItem */

const item = (n) => ({
  id: `sample-gallery-${n}`,
  url: `assets/images/gallery/full/specimen-${String(n).padStart(3, '0')}.jpg`,
  title: null,
  caption: null,
  altText: `Specimen CC-${String(n).padStart(3, '0')}`,
  sortOrder: n - 1,
  featured: false,
});

/** @type {GalleryItem[]} */
export const SAMPLE_GALLERY_ITEMS = [1, 2, 3, 4, 5, 6].map(item);
