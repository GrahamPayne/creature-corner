import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from './config.js';
import { SAMPLE_CATEGORIES, SAMPLE_PRODUCTS } from '../data/sample-products.js';

/** @typedef {import('../types/typedefs.js').Product} Product */
/** @typedef {import('../types/typedefs.js').ShopCategory} ShopCategory */

// Drafts and hidden products never reach the public shop. Mirrors the
// Supabase RLS policy on `products` (see supabase/schema.sql) so the sample
// data behaves the same way the real database does.
const PUBLIC_STATUSES = ['available', 'sold'];

/** @returns {Promise<ShopCategory[]>} */
export async function getCategories() {
  if (!isSupabaseConfigured()) return SAMPLE_CATEGORIES;

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.from('categories').select('*').order('sort_order');
  if (error) throw error;
  return data.map((row) => ({ slug: row.slug, name: row.name }));
}

/**
 * @param {{categorySlug?: string|null}} [opts]
 * @returns {Promise<Product[]>}
 */
export async function getProducts({ categorySlug } = {}) {
  if (!isSupabaseConfigured()) {
    let products = SAMPLE_PRODUCTS.filter((p) => PUBLIC_STATUSES.includes(p.status));
    if (categorySlug) products = products.filter((p) => p.category?.slug === categorySlug);
    return products;
  }

  const supabase = await getSupabaseClient();
  let query = supabase
    .from('products')
    .select('*, category:categories(slug, name), images:product_images(storage_path, sort_order, is_primary)')
    .in('status', PUBLIC_STATUSES)
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  let products = data.map((row) => normalizeRow(row, supabase));
  if (categorySlug) products = products.filter((p) => p.category?.slug === categorySlug);
  return products;
}

/**
 * @param {string} slug
 * @returns {Promise<Product|null>}
 */
export async function getProductBySlug(slug) {
  if (!isSupabaseConfigured()) {
    const product = SAMPLE_PRODUCTS.find((p) => p.slug === slug && PUBLIC_STATUSES.includes(p.status));
    return product || null;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(slug, name), images:product_images(storage_path, sort_order, is_primary)')
    .eq('slug', slug)
    .in('status', PUBLIC_STATUSES)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeRow(data, supabase) : null;
}

function normalizeRow(row, supabase) {
  const images = (row.images || [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({
      url: supabase.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl,
      isPrimary: img.is_primary,
    }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceCents: row.price_cents,
    shortDescription: row.short_description,
    description: row.description,
    category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
    dimensions: row.dimensions,
    materials: row.materials,
    quantity: row.quantity,
    shippingClass: row.shipping_class,
    pickupAvailable: row.pickup_available,
    featured: row.featured,
    status: row.status,
    images,
  };
}
