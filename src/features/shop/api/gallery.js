import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from './config.js';
import { SAMPLE_GALLERY_ITEMS } from '../data/sample-gallery.js';
import { SAMPLE_GALLERY_SECTIONS, SAMPLE_SECTION_ITEMS } from '../data/sample-gallery-sections.js';

/** @typedef {import('../types/typedefs.js').GalleryItem} GalleryItem */

const GALLERY_BUCKET = 'gallery-images';

function normalizeItem(row, supabase) {
  return {
    id: row.id,
    url: supabase.storage.from(GALLERY_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    title: row.title,
    caption: row.caption,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    featured: row.featured,
  };
}

async function fetchVisibleSectionsAndItems(supabase) {
  const [{ data: sectionRows, error: sErr }, { data: itemRows, error: iErr }] = await Promise.all([
    supabase.from('gallery_sections').select('*').eq('visible', true).order('sort_order'),
    supabase
      .from('gallery_items')
      .select('id, storage_path, title, caption, alt_text, sort_order, featured, gallery_section_id, created_at')
      .eq('visible', true),
  ]);
  if (sErr) throw sErr;
  if (iErr) throw iErr;
  return { sectionRows, itemRows };
}

/**
 * Visible gallery sections, in admin-set order, each with a resolved
 * cover image (the section's chosen cover if it's still a visible item
 * in that section, else the first visible item in it by sort_order) and
 * item count. A section with zero visible items is left out entirely —
 * there would be no cover to show, and a blank/broken card is worse than
 * no card (same "never show a broken image" rule as everywhere else on
 * the site). The Admin Gallery Sections list still shows every section
 * regardless of this.
 * @returns {Promise<{id:string, name:string, slug:string, coverUrl:string|null, itemCount:number}[]>}
 */
export async function getGallerySections() {
  if (!isSupabaseConfigured()) return SAMPLE_GALLERY_SECTIONS;

  const supabase = await getSupabaseClient();
  const { sectionRows, itemRows } = await fetchVisibleSectionsAndItems(supabase);

  return sectionRows
    .map((s) => {
      const sectionItems = itemRows.filter((i) => i.gallery_section_id === s.id).sort((a, b) => a.sort_order - b.sort_order);
      const coverRow = sectionItems.find((i) => i.id === s.featured_gallery_item_id) || sectionItems[0] || null;
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        coverUrl: coverRow ? supabase.storage.from(GALLERY_BUCKET).getPublicUrl(coverRow.storage_path).data.publicUrl : null,
        itemCount: sectionItems.length,
      };
    })
    .filter((s) => s.itemCount > 0);
}

/**
 * A single visible section's visible items, in sort_order — the
 * `?section=<slug>` view. Returns null for an unknown or hidden slug so
 * the caller can show a graceful not-found state (never a raw error).
 * @param {string} slug
 * @returns {Promise<{name: string, items: GalleryItem[]}|null>}
 */
export async function getGallerySectionItems(slug) {
  if (!isSupabaseConfigured()) {
    const section = SAMPLE_GALLERY_SECTIONS.find((s) => s.slug === slug);
    return section ? { name: section.name, items: SAMPLE_SECTION_ITEMS[slug] || [] } : null;
  }

  const supabase = await getSupabaseClient();
  const { data: sectionRow, error: sErr } = await supabase
    .from('gallery_sections')
    .select('*')
    .eq('slug', slug)
    .eq('visible', true)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!sectionRow) return null;

  const { data: itemRows, error: iErr } = await supabase
    .from('gallery_items')
    .select('id, storage_path, title, caption, alt_text, sort_order, featured')
    .eq('gallery_section_id', sectionRow.id)
    .eq('visible', true)
    .order('sort_order');
  if (iErr) throw iErr;

  return { name: sectionRow.name, items: itemRows.map((row) => normalizeItem(row, supabase)) };
}

/**
 * "All Work": every visible item that is both assigned to a section and
 * that section is itself visible — unassigned images are intentionally
 * excluded (they're not ready for the public page yet). Ordered by
 * upload recency since sort_order is scoped per section now and has no
 * single meaningful order once flattened across sections.
 * @returns {Promise<GalleryItem[]>}
 */
export async function getAllWorkItems() {
  if (!isSupabaseConfigured()) return SAMPLE_GALLERY_ITEMS;

  const supabase = await getSupabaseClient();
  const { sectionRows, itemRows } = await fetchVisibleSectionsAndItems(supabase);
  const visibleSectionIds = new Set(sectionRows.map((s) => s.id));

  return itemRows
    .filter((i) => i.gallery_section_id && visibleSectionIds.has(i.gallery_section_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((row) => normalizeItem(row, supabase));
}
