/**
 * PROTOTYPE GALLERY SECTIONS DATA — placeholder only, used until a real
 * Supabase project is connected (see docs/SHOP_SETUP.md). Mirrors the
 * shape api/gallery.js's getGallerySections()/getGallerySectionItems()
 * produce from real gallery_sections/gallery_items rows.
 */

import { SAMPLE_GALLERY_ITEMS } from './sample-gallery.js';

/** @type {{id:string, name:string, slug:string, coverUrl:string|null, itemCount:number}[]} */
export const SAMPLE_GALLERY_SECTIONS = [
  { id: 'sample-section-specimens', name: 'Specimens', slug: 'specimens', coverUrl: SAMPLE_GALLERY_ITEMS[0]?.url ?? null, itemCount: 3 },
  { id: 'sample-section-artifacts', name: 'Artifacts', slug: 'artifacts', coverUrl: SAMPLE_GALLERY_ITEMS[3]?.url ?? null, itemCount: 3 },
];

/** @type {Record<string, import('../types/typedefs.js').GalleryItem[]>} */
export const SAMPLE_SECTION_ITEMS = {
  specimens: SAMPLE_GALLERY_ITEMS.slice(0, 3),
  artifacts: SAMPLE_GALLERY_ITEMS.slice(3, 6),
};
