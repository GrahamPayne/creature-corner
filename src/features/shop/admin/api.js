import { getSupabaseClient } from '../api/supabaseClient.js';
import { slugify } from './slug.js';

const PRODUCT_SELECT = '*, category:categories(id, slug, name), images:product_images(id, storage_path, sort_order, is_primary)';

async function client() {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function normalizeRow(row, supabase) {
  const images = (row.images || [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({
      id: img.id,
      url: supabase.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl,
      storagePath: img.storage_path,
      isPrimary: img.is_primary,
    }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceCents: row.price_cents,
    shortDescription: row.short_description,
    description: row.description,
    category: row.category ? { id: row.category.id, slug: row.category.slug, name: row.category.name } : null,
    dimensions: row.dimensions,
    materials: row.materials,
    quantity: row.quantity,
    shippingClass: row.shipping_class,
    pickupAvailable: row.pickup_available,
    featured: row.featured,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    images,
  };
}

/** Converts camelCase form fields to the snake_case columns products expects. Only includes keys actually present in `fields`, so this doubles as a partial-patch builder. */
export function toDbPatch(fields) {
  const map = {
    name: 'name',
    slug: 'slug',
    priceCents: 'price_cents',
    shortDescription: 'short_description',
    description: 'description',
    categoryId: 'category_id',
    dimensions: 'dimensions',
    materials: 'materials',
    quantity: 'quantity',
    shippingClass: 'shipping_class',
    pickupAvailable: 'pickup_available',
    featured: 'featured',
    status: 'status',
  };
  const patch = {};
  for (const [camel, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(fields, camel)) patch[column] = fields[camel];
  }
  return patch;
}

/** @returns {Promise<{id: string, slug: string, name: string}[]>} */
export async function adminListCategories() {
  const supabase = await client();
  const { data, error } = await supabase.from('categories').select('id, slug, name').order('sort_order');
  if (error) throw error;
  return data;
}

export async function adminListProducts() {
  const supabase = await client();
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => normalizeRow(row, supabase));
}

export async function adminGetProduct(id) {
  const supabase = await client();
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).single();
  if (error) throw error;
  return normalizeRow(data, supabase);
}

/** @param {string} slug @param {string} [excludeId] */
export async function slugExists(slug, excludeId) {
  const supabase = await client();
  let query = supabase.from('products').select('id').eq('slug', slug);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function adminCreateProduct(fields) {
  const supabase = await client();
  const patch = toDbPatch(fields);
  const { data, error } = await supabase.from('products').insert(patch).select(PRODUCT_SELECT).single();
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already in use — try another.');
    throw error;
  }
  return normalizeRow(data, supabase);
}

export async function adminUpdateProduct(id, patch) {
  const supabase = await client();
  const { data, error } = await supabase
    .from('products')
    .update(toDbPatch(patch))
    .eq('id', id)
    .select(PRODUCT_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already in use — try another.');
    throw error;
  }
  return normalizeRow(data, supabase);
}

/** Hard delete. See docs/SHOP_SETUP.md for why this is safe (product_images cascades, order_items.product_id is SET NULL). */
export async function adminDeleteProduct(id) {
  const supabase = await client();
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

/** Finds a free slug server-side by incrementing a numeric suffix (async, unlike slug.js's sync uniqueSlug which checks an in-memory list). */
async function uniqueSlugAsync(base) {
  const root = slugify(base) || 'item';
  let candidate = root;
  let n = 2;
  while (await slugExists(candidate)) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

/** Copies a product's fields (not its images) into a new draft row with a fresh unique slug. */
export async function adminDuplicateProduct(id) {
  const original = await adminGetProduct(id);
  const slug = await uniqueSlugAsync(`${original.slug}-copy`);
  return adminCreateProduct({
    name: `${original.name} (Copy)`,
    slug,
    priceCents: original.priceCents,
    shortDescription: original.shortDescription,
    description: original.description,
    categoryId: original.category?.id ?? null,
    dimensions: original.dimensions,
    materials: original.materials,
    quantity: original.quantity,
    shippingClass: original.shippingClass,
    pickupAvailable: original.pickupAvailable,
    featured: false,
    status: 'draft',
  });
}
