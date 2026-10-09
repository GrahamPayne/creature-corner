import { deriveFulfillmentMode, fulfillmentRequiresPackedData } from './fulfillment.js';

/**
 * Single reusable product-readiness model (Stage 6.75) — used by the
 * Products table badge, the Add/Edit Product checklist, and the
 * publish-safety gate, so the rules exist in exactly one place.
 *
 * `blocking` checks gate the Draft/Hidden -> Available transition
 * (see canPublish). `warning` checks never block saving — a product with
 * no photo yet must stay editable/saveable as Draft.
 */

/**
 * A size-class product is "usable" for shipping if its flat rate is
 * configured, OR local pickup is also offered on it (so the product can
 * still be sold via pickup even with an unset rate) — pickup_only and
 * special_quote are always usable since neither needs a flat rate.
 * @param {{shippingClass: string, pickupAvailable: boolean}} product
 * @param {Record<string, number|null>} [shippingRates]
 */
function hasUsableShipping(product, shippingRates = {}) {
  const cls = product.shippingClass;
  if (cls === 'pickup_only' || cls === 'special_quote') return true;
  const rate = shippingRates[cls];
  const rateConfigured = rate !== null && rate !== undefined;
  return rateConfigured || product.pickupAvailable === true;
}

/**
 * @param {any} product - camelCase product/draft shape (priceCents, categoryId|category, quantity, shippingClass, pickupAvailable, images, shortDescription, description, materials, dimensions, packedWeightLb, packedWeightOz, packageLengthIn, packageWidthIn, packageHeightIn)
 * @param {{shippingRates?: Record<string, number|null>}} [opts]
 * @returns {{key: string, label: string, ok: boolean, severity: 'warning'|'blocking'}[]}
 */
export function computeReadinessChecks(product, { shippingRates = {} } = {}) {
  const checks = [];
  const push = (key, label, ok, severity) => checks.push({ key, label, ok: Boolean(ok), severity });

  const hasCategory = Boolean(product.categoryId ?? product.category?.id ?? product.category);

  push('price', 'Price', Number.isFinite(product.priceCents) && product.priceCents > 0, 'blocking');
  push('category', 'Category', hasCategory, 'blocking');
  push('quantity', 'Quantity', Number(product.quantity) > 0, 'blocking');
  push('shipping', 'Shipping configuration', hasUsableShipping(product, shippingRates), 'blocking');

  push('image', 'Product photo', (product.imageCount ?? product.images?.length ?? 0) > 0, 'warning');
  push('shortDescription', 'Short description', Boolean(product.shortDescription?.trim()), 'warning');
  push('description', 'Full description', Boolean(product.description?.trim()), 'warning');
  push('materials', 'Materials', Boolean(product.materials?.trim()), 'warning');
  push('dimensions', 'Artwork dimensions', Boolean(product.dimensions?.trim()), 'warning');

  const mode = deriveFulfillmentMode(product);
  if (fulfillmentRequiresPackedData(mode)) {
    const weightOz = (Number(product.packedWeightLb) || 0) * 16 + (Number(product.packedWeightOz) || 0);
    const hasDimensions = Boolean(product.packageLengthIn) && Boolean(product.packageWidthIn) && Boolean(product.packageHeightIn);
    push('packedWeight', 'Packed weight', weightOz > 0, 'warning');
    push('packedDimensions', 'Packed dimensions', hasDimensions, 'warning');
  }

  return checks;
}

/**
 * @param {{status: string}} product
 * @param {ReturnType<typeof computeReadinessChecks>} checks
 * @returns {'draft'|'ready'|'needs_info'}
 */
export function getReadinessStatus(product, checks) {
  if (product.status === 'draft') return 'draft';
  return checks.every((c) => c.ok) ? 'ready' : 'needs_info';
}

/** @param {ReturnType<typeof computeReadinessChecks>} checks */
export function getBlockingIssues(checks) {
  return checks.filter((c) => c.severity === 'blocking' && !c.ok);
}

/**
 * @param {any} product
 * @param {{shippingRates?: Record<string, number|null>}} [opts]
 */
export function canPublish(product, opts) {
  return getBlockingIssues(computeReadinessChecks(product, opts)).length === 0;
}
