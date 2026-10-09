import { getSupabaseClient } from '../api/supabaseClient.js';
import { slugify } from './slug.js';
import { uniqueImagePath } from './storagePath.js';
import { resizeImageForUpload } from './imageProcessing.js';
import { pickPrimaryImage } from '../primaryImage.js';

const IMAGE_BUCKET = 'product-images';

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
      productId: row.id,
      url: supabase.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl,
      storagePath: img.storage_path,
      isPrimary: img.is_primary,
      sortOrder: img.sort_order,
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
    packedWeightLb: row.packed_weight_lb,
    packedWeightOz: row.packed_weight_oz,
    packageLengthIn: row.package_length_in,
    packageWidthIn: row.package_width_in,
    packageHeightIn: row.package_height_in,
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
    packedWeightLb: 'packed_weight_lb',
    packedWeightOz: 'packed_weight_oz',
    packageLengthIn: 'package_length_in',
    packageWidthIn: 'package_width_in',
    packageHeightIn: 'package_height_in',
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

/**
 * Hard delete. See docs/SHOP_SETUP.md for why the product_images DB rows are
 * safe to cascade-delete (order_items.product_id is SET NULL). Storage
 * objects are a separate system with no DB-level cascade to them, so they're
 * explicitly removed here first — otherwise they'd be orphaned forever.
 */
export async function adminDeleteProduct(id) {
  const supabase = await client();
  const product = await adminGetProduct(id);
  if (product.images.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(IMAGE_BUCKET)
      .remove(product.images.map((img) => img.storagePath));
    if (storageError) throw storageError;
  }
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

function normalizeImage(row, supabase) {
  return {
    id: row.id,
    productId: row.product_id,
    url: supabase.storage.from(IMAGE_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    storagePath: row.storage_path,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
  };
}

/**
 * Resizes/re-encodes `file` in the browser, uploads it to the
 * product-images bucket at a fresh unique path, and inserts the matching
 * product_images row. Requires an authenticated admin session — both the
 * Storage upload and the table insert are RLS-gated on is_admin().
 * @param {string} productId
 * @param {File} file
 * @param {{isPrimary?: boolean, sortOrder: number}} opts
 */
export async function uploadProductImage(productId, file, { isPrimary = false, sortOrder }) {
  const supabase = await client();
  const { blob, extension } = await resizeImageForUpload(file);
  const path = uniqueImagePath(productId, extension);

  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (uploadError) throw new Error(`Upload failed for "${file.name}": ${uploadError.message}`);

  if (isPrimary) await clearPrimaryFlag(supabase, productId);

  const { data, error } = await supabase
    .from('product_images')
    .insert({ product_id: productId, storage_path: path, sort_order: sortOrder, is_primary: isPrimary })
    .select()
    .single();
  if (error) {
    // Roll back the orphaned Storage object if the DB insert failed.
    await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    throw error;
  }
  return normalizeImage(data, supabase);
}

async function clearPrimaryFlag(supabase, productId) {
  const { error } = await supabase.from('product_images').update({ is_primary: false }).eq('product_id', productId);
  if (error) throw error;
}

/** @param {string} productId @param {string} imageId */
export async function adminSetPrimaryImage(productId, imageId) {
  const supabase = await client();
  await clearPrimaryFlag(supabase, productId);
  const { error } = await supabase.from('product_images').update({ is_primary: true }).eq('id', imageId);
  if (error) throw error;
}

/**
 * Deletes both the Storage object and the DB row. Storage is removed first;
 * if that fails the DB row is kept so the image (and the ability to retry)
 * isn't silently lost. If the deleted image was primary, promotes the next
 * remaining image (by sort_order) to primary, so a product is never left
 * with zero primary images while it still has photos.
 */
export async function adminDeleteProductImage(image) {
  const supabase = await client();
  const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove([image.storagePath]);
  if (storageError) throw storageError;
  const { error } = await supabase.from('product_images').delete().eq('id', image.id);
  if (error) throw error;

  if (image.isPrimary && image.productId) {
    const { data: remaining, error: fetchError } = await supabase
      .from('product_images')
      .select('id')
      .eq('product_id', image.productId)
      .order('sort_order')
      .limit(1);
    if (!fetchError && remaining && remaining.length > 0) {
      await supabase.from('product_images').update({ is_primary: true }).eq('id', remaining[0].id);
    }
  }
}

/** Renumbers sort_order 0..N-1 to match `orderedImageIds`, so order is always deterministic with no gaps. */
export async function adminReorderImages(orderedImageIds) {
  const supabase = await client();
  const results = await Promise.all(
    orderedImageIds.map((id, index) => supabase.from('product_images').update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
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
    packedWeightLb: original.packedWeightLb,
    packedWeightOz: original.packedWeightOz,
    packageLengthIn: original.packageLengthIn,
    packageWidthIn: original.packageWidthIn,
    packageHeightIn: original.packageHeightIn,
    featured: false,
    status: 'draft',
  });
}

/** @returns {Promise<{key: string, label: string, flatPriceCents: number|null}[]>} */
export async function adminListShippingClasses() {
  const supabase = await client();
  const { data, error } = await supabase.from('shipping_classes').select('*');
  if (error) throw error;
  return data.map((row) => ({ key: row.key, label: row.label, flatPriceCents: row.flat_price_cents }));
}

/** @param {string} key @param {number} cents */
export async function adminUpdateShippingRate(key, cents) {
  const supabase = await client();
  const { error } = await supabase.from('shipping_classes').update({ flat_price_cents: cents }).eq('key', key);
  if (error) throw error;
}

function normalizeCategory(row) {
  return { id: row.id, slug: row.slug, name: row.name, sortOrder: row.sort_order };
}

/**
 * Categories plus how many products currently reference each one (needed
 * to safely block deletion). Two queries, counted client-side, rather than
 * a Postgres-side GROUP BY — simpler to keep consistent with the rest of
 * this file's plain select/insert/update calls.
 * @returns {Promise<{id:string, slug:string, name:string, sortOrder:number, productCount:number}[]>}
 */
export async function adminListCategoriesWithCounts() {
  const supabase = await client();
  const [{ data: categories, error: catError }, { data: products, error: prodError }] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('products').select('category_id'),
  ]);
  if (catError) throw catError;
  if (prodError) throw prodError;

  const counts = {};
  for (const p of products) {
    if (p.category_id) counts[p.category_id] = (counts[p.category_id] || 0) + 1;
  }
  return categories.map((row) => ({ ...normalizeCategory(row), productCount: counts[row.id] || 0 }));
}

/** @param {{name: string, slug: string}} fields */
export async function adminCreateCategory({ name, slug }) {
  const supabase = await client();
  const { data: last, error: lastError } = await supabase
    .from('categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (lastError) throw lastError;
  const sortOrder = last.length > 0 ? last[0].sort_order + 1 : 0;

  const { data, error } = await supabase.from('categories').insert({ name, slug, sort_order: sortOrder }).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already in use — try another.');
    throw error;
  }
  return normalizeCategory(data);
}

/** @param {string} id @param {{name?: string, slug?: string}} fields */
export async function adminUpdateCategory(id, fields) {
  const supabase = await client();
  const patch = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.slug !== undefined) patch.slug = fields.slug;

  const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already in use — try another.');
    throw error;
  }
  return normalizeCategory(data);
}

/** Renumbers sort_order 0..N-1 to match orderedCategoryIds — same pattern as adminReorderImages above. @param {string[]} orderedCategoryIds */
export async function adminReorderCategories(orderedCategoryIds) {
  const supabase = await client();
  const results = await Promise.all(
    orderedCategoryIds.map((id, index) => supabase.from('categories').update({ sort_order: index }).eq('id', id))
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

/**
 * Blocks deletion (rather than deleting and orphaning products, or
 * cascading silently) when any product still references this category.
 * @param {string} id
 */
export async function adminDeleteCategory(id) {
  const supabase = await client();
  const { count, error: countError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);
  if (countError) throw countError;
  if (count > 0) {
    throw new Error(`This category is currently used by ${count} product${count === 1 ? '' : 's'} and cannot be deleted.`);
  }

  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

const ORDER_SELECT = `
  *,
  items:order_items(
    id, product_id, product_name, unit_price_cents, quantity,
    product:products(slug, images:product_images(storage_path, is_primary, sort_order))
  )
`;

/** "Needs fulfillment" (paid, not yet fulfilled) is intentionally not its own status — it's derived here, not stored, so Stage 7/8 never has to migrate a redundant column. */
export function deriveNeedsFulfillment(order) {
  return order.status === 'paid';
}

function normalizeOrder(row, supabase) {
  const items = (row.items || []).map((item) => {
    const images = (item.product?.images || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((img) => ({ url: supabase.storage.from('product-images').getPublicUrl(img.storage_path).data.publicUrl, isPrimary: img.is_primary }));
    const thumbnail = pickPrimaryImage(images);
    return {
      id: item.id,
      productId: item.product_id,
      productSlug: item.product?.slug ?? null,
      name: item.product_name,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
      lineTotalCents: item.unit_price_cents * item.quantity,
      thumbnailUrl: thumbnail?.url ?? null,
    };
  });

  return {
    id: row.id,
    email: row.email,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    status: row.status,
    fulfillmentType: row.fulfillment_type,
    shippingAddress: row.shipping_address,
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

/** @returns {Promise<ReturnType<typeof normalizeOrder>[]>} */
export async function adminListOrders() {
  const supabase = await client();
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((row) => normalizeOrder(row, supabase));
}
