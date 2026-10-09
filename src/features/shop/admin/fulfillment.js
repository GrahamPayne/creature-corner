/**
 * Pure helpers for the product form's "Fulfillment" and "Packed Shipping
 * Info" sections. A product's fulfillment mode is never stored as its own
 * column — it's fully derived from the existing `shippingClass` +
 * `pickupAvailable` columns (see supabase/schema.sql / migrations/
 * 002_stage_6_5.sql), so these just translate between the 4-option UI
 * concept and those two columns.
 */

export const FULFILLMENT_MODES = [
  ['ship_and_pickup', 'Shipping + Local Pickup'],
  ['ship_only', 'Shipping Only'],
  ['pickup_only', 'Local Pickup Only'],
  ['special_quote', 'Special Shipping / Manual Quote'],
];

export const PACKAGE_SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
  ['oversized', 'Oversized'],
];

/** @param {{shippingClass?: string, pickupAvailable?: boolean}} [product] */
export function deriveFulfillmentMode(product) {
  const shippingClass = product?.shippingClass;
  if (shippingClass === 'special_quote') return 'special_quote';
  if (shippingClass === 'pickup_only') return 'pickup_only';
  return product?.pickupAvailable ? 'ship_and_pickup' : 'ship_only';
}

/** The package-size select only has a value to contribute for the two "ships" modes. */
export function fulfillmentNeedsPackageSize(mode) {
  return mode === 'ship_and_pickup' || mode === 'ship_only';
}

/** Packed weight/dimensions are only required (not just allowed) when a flat/future-automatic rate will need them. */
export function fulfillmentRequiresPackedData(mode) {
  return mode === 'ship_and_pickup' || mode === 'ship_only';
}

/**
 * @param {string} mode
 * @param {string} packageSize
 * @returns {{shippingClass: string, pickupAvailable: boolean}}
 */
export function resolveFulfillment(mode, packageSize) {
  switch (mode) {
    case 'ship_and_pickup':
      return { shippingClass: packageSize, pickupAvailable: true };
    case 'ship_only':
      return { shippingClass: packageSize, pickupAvailable: false };
    case 'pickup_only':
      return { shippingClass: 'pickup_only', pickupAvailable: true };
    case 'special_quote':
      return { shippingClass: 'special_quote', pickupAvailable: false };
    default:
      throw new Error(`Unknown fulfillment mode: ${mode}`);
  }
}

/**
 * @param {{packedWeightLb: number, packedWeightOz: number, packageLengthIn: number|null, packageWidthIn: number|null, packageHeightIn: number|null}} packed
 * @param {{requirePositive: boolean}} opts
 * @returns {string|null} an error message, or null if valid
 */
export function validatePackedShipping(packed, { requirePositive }) {
  const { packedWeightLb, packedWeightOz, packageLengthIn, packageWidthIn, packageHeightIn } = packed;

  if (packedWeightLb < 0 || packedWeightOz < 0) {
    return 'Packed weight cannot be negative.';
  }
  if (packedWeightOz > 15) {
    return 'Packed weight ounces must be between 0 and 15 (carry over to pounds above 15).';
  }
  if (packageLengthIn !== null && packageLengthIn < 0) return 'Package length cannot be negative.';
  if (packageWidthIn !== null && packageWidthIn < 0) return 'Package width cannot be negative.';
  if (packageHeightIn !== null && packageHeightIn < 0) return 'Package height cannot be negative.';

  if (requirePositive) {
    if (!packageLengthIn || !packageWidthIn || !packageHeightIn || packageLengthIn <= 0 || packageWidthIn <= 0 || packageHeightIn <= 0) {
      return 'Package length, width, and height must each be greater than zero for a shippable product.';
    }
    if (packedWeightLb * 16 + packedWeightOz <= 0) {
      return 'Packed weight must be greater than zero for a shippable product.';
    }
  }

  return null;
}
