import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from './config.js';
import { SAMPLE_GALLERY_ITEMS } from '../data/sample-gallery.js';

/** @typedef {import('../types/typedefs.js').GalleryItem} GalleryItem */

const GALLERY_BUCKET = 'gallery-images';

/**
 * Visible gallery items, in admin-set display order. Mirrors
 * api/products.js's public-read pattern: hidden items never reach this
 * client (both via the `visible = true` RLS policy and the explicit
 * filter below, same belt-and-suspenders approach as PUBLIC_STATUSES).
 * @returns {Promise<GalleryItem[]>}
 */
export async function getGalleryItems() {
  if (!isSupabaseConfigured()) return SAMPLE_GALLERY_ITEMS;

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('gallery_items')
    .select('id, storage_path, title, caption, alt_text, sort_order, featured')
    .eq('visible', true)
    .order('sort_order');
  if (error) throw error;

  return data.map((row) => ({
    id: row.id,
    url: supabase.storage.from(GALLERY_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    title: row.title,
    caption: row.caption,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    featured: row.featured,
  }));
}
