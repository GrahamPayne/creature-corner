import { getSupabaseClient } from '../api/supabaseClient.js';
import { uniqueGalleryImagePath } from './storagePath.js';
import { resizeImageForUpload } from './imageProcessing.js';

const GALLERY_BUCKET = 'gallery-images';

async function client() {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function normalizeItem(row, supabase) {
  return {
    id: row.id,
    storagePath: row.storage_path,
    url: supabase.storage.from(GALLERY_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    title: row.title,
    caption: row.caption,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    visible: row.visible,
    featured: row.featured,
  };
}

/** Admin sees every item regardless of visibility — the public-only filter lives in api/gallery.js's RLS-backed query. @returns {Promise<any[]>} */
export async function adminListGalleryItems() {
  const supabase = await client();
  const { data, error } = await supabase.from('gallery_items').select('*').order('sort_order');
  if (error) throw error;
  return data.map((row) => normalizeItem(row, supabase));
}

/** @param {string} id @param {{title?: string|null, caption?: string|null, altText?: string|null, visible?: boolean, featured?: boolean}} patch */
export async function adminUpdateGalleryItem(id, patch) {
  const supabase = await client();
  const dbPatch = {};
  if ('title' in patch) dbPatch.title = patch.title;
  if ('caption' in patch) dbPatch.caption = patch.caption;
  if ('altText' in patch) dbPatch.alt_text = patch.altText;
  if ('visible' in patch) dbPatch.visible = patch.visible;
  if ('featured' in patch) dbPatch.featured = patch.featured;

  const { data, error } = await supabase.from('gallery_items').update(dbPatch).eq('id', id).select().single();
  if (error) throw error;
  return normalizeItem(data, supabase);
}

/** Renumbers sort_order 0..N-1 to match orderedIds — same pattern as admin/api.js's adminReorderImages/adminReorderCategories. @param {string[]} orderedIds */
export async function adminReorderGalleryItems(orderedIds) {
  const supabase = await client();
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from('gallery_items').update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

/**
 * Resizes/re-encodes `file` in the browser (same pipeline as product
 * photos), uploads it to the gallery-images bucket at a fresh unique
 * path, and inserts the matching gallery_items row. Requires an
 * authenticated admin session — both the Storage upload and the table
 * insert are RLS-gated on is_admin().
 * @param {File} file
 * @param {{sortOrder: number}} opts
 */
export async function uploadGalleryImage(file, { sortOrder }) {
  const supabase = await client();
  const { blob, extension } = await resizeImageForUpload(file);
  const path = uniqueGalleryImagePath(extension);

  const { error: uploadError } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (uploadError) throw new Error(`Upload failed for "${file.name}": ${uploadError.message}`);

  const { data, error } = await supabase
    .from('gallery_items')
    .insert({ storage_path: path, sort_order: sortOrder })
    .select()
    .single();
  if (error) {
    // Roll back the orphaned Storage object if the DB insert failed.
    await supabase.storage.from(GALLERY_BUCKET).remove([path]);
    throw error;
  }
  return normalizeItem(data, supabase);
}

/** Deletes the Storage object first, then the DB row — mirrors adminDeleteProductImage's ordering/reasoning, so a failure never leaves an orphaned file. @param {{id: string, storagePath: string}} item */
export async function adminDeleteGalleryItem(item) {
  const supabase = await client();
  const { error: storageError } = await supabase.storage.from(GALLERY_BUCKET).remove([item.storagePath]);
  if (storageError) throw storageError;
  const { error } = await supabase.from('gallery_items').delete().eq('id', item.id);
  if (error) throw error;
}
