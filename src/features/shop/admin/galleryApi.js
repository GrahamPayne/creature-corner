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
    gallerySectionId: row.gallery_section_id,
  };
}

function normalizeSection(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    visible: row.visible,
    featuredGalleryItemId: row.featured_gallery_item_id,
  };
}

/** Admin sees every item regardless of visibility — the public-only filter lives in api/gallery.js's RLS-backed query. @returns {Promise<any[]>} */
export async function adminListGalleryItems() {
  const supabase = await client();
  const { data, error } = await supabase.from('gallery_items').select('*').order('sort_order');
  if (error) throw error;
  return data.map((row) => normalizeItem(row, supabase));
}

/** @param {string} id @param {{title?: string|null, caption?: string|null, altText?: string|null, visible?: boolean, featured?: boolean, gallerySectionId?: string|null, sortOrder?: number}} patch */
export async function adminUpdateGalleryItem(id, patch) {
  const supabase = await client();
  const dbPatch = {};
  if ('title' in patch) dbPatch.title = patch.title;
  if ('caption' in patch) dbPatch.caption = patch.caption;
  if ('altText' in patch) dbPatch.alt_text = patch.altText;
  if ('visible' in patch) dbPatch.visible = patch.visible;
  if ('featured' in patch) dbPatch.featured = patch.featured;
  if ('gallerySectionId' in patch) dbPatch.gallery_section_id = patch.gallerySectionId;
  if ('sortOrder' in patch) dbPatch.sort_order = patch.sortOrder;

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
 * @param {{sortOrder: number, gallerySectionId?: string|null}} opts
 */
export async function uploadGalleryImage(file, { sortOrder, gallerySectionId = null }) {
  const supabase = await client();
  const { blob, extension } = await resizeImageForUpload(file);
  const path = uniqueGalleryImagePath(extension);

  const { error: uploadError } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (uploadError) throw new Error(`Upload failed for "${file.name}": ${uploadError.message}`);

  const { data, error } = await supabase
    .from('gallery_items')
    .insert({ storage_path: path, sort_order: sortOrder, gallery_section_id: gallerySectionId })
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

// ============================================================
// GALLERY SECTIONS
// Entirely separate from the shop's categories table — see
// supabase/migrations/004_gallery_sections.sql.
// ============================================================

/** @returns {Promise<any[]>} */
export async function adminListGallerySections() {
  const supabase = await client();
  const { data, error } = await supabase.from('gallery_sections').select('*').order('sort_order');
  if (error) throw error;
  return data.map(normalizeSection);
}

/** @param {{name: string, slug: string}} fields */
export async function adminCreateGallerySection({ name, slug }) {
  const supabase = await client();
  const { data: last, error: lastError } = await supabase
    .from('gallery_sections')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (lastError) throw lastError;
  const sortOrder = last.length > 0 ? last[0].sort_order + 1 : 0;

  const { data, error } = await supabase.from('gallery_sections').insert({ name, slug, sort_order: sortOrder }).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already in use — try another.');
    throw error;
  }
  return normalizeSection(data);
}

/** @param {string} id @param {{name?: string, slug?: string, visible?: boolean}} fields */
export async function adminUpdateGallerySection(id, fields) {
  const supabase = await client();
  const patch = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.slug !== undefined) patch.slug = fields.slug;
  if (fields.visible !== undefined) patch.visible = fields.visible;

  const { data, error } = await supabase.from('gallery_sections').update(patch).eq('id', id).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already in use — try another.');
    throw error;
  }
  return normalizeSection(data);
}

/** Renumbers sort_order 0..N-1 to match orderedIds — same pattern as adminReorderCategories. @param {string[]} orderedIds */
export async function adminReorderGallerySections(orderedIds) {
  const supabase = await client();
  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from('gallery_sections').update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

/** Blocks deletion (rather than orphaning assigned images) when any gallery item still references this section. @param {string} id */
export async function adminDeleteGallerySection(id) {
  const supabase = await client();
  const { count, error: countError } = await supabase
    .from('gallery_items')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_section_id', id);
  if (countError) throw countError;
  if (count > 0) {
    throw new Error(`This section contains ${count} gallery image${count === 1 ? '' : 's'} and cannot be deleted.`);
  }

  const { error } = await supabase.from('gallery_sections').delete().eq('id', id);
  if (error) throw error;
}

/** @param {string} sectionId @param {string|null} itemId - pass null to clear the cover */
export async function adminSetSectionCover(sectionId, itemId) {
  const supabase = await client();
  const { data, error } = await supabase
    .from('gallery_sections')
    .update({ featured_gallery_item_id: itemId })
    .eq('id', sectionId)
    .select()
    .single();
  if (error) throw error;
  return normalizeSection(data);
}
