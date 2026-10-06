/**
 * @typedef {Object} ShopCategory
 * @property {string} slug
 * @property {string} name
 */

/**
 * @typedef {Object} ProductImage
 * @property {string|null} url
 * @property {boolean} isPrimary
 */

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {number} priceCents
 * @property {string} [shortDescription]
 * @property {string} [description]
 * @property {ShopCategory|null} category
 * @property {string} [dimensions]
 * @property {string} [materials]
 * @property {number} quantity
 * @property {'small'|'medium'|'large'|'oversized'|'pickup_only'} shippingClass
 * @property {boolean} pickupAvailable
 * @property {boolean} featured
 * @property {'draft'|'available'|'sold'|'hidden'} status
 * @property {ProductImage[]} images
 */

export {};
