/**
 * PROTOTYPE SHOP DATA — placeholder only.
 * Used until a real Supabase project is connected (see docs/SHOP_SETUP.md).
 * Images reuse existing gallery photography as stand-ins; real product
 * photos get uploaded per-item through the admin once it exists (Stage 4+).
 * Mirrors the shape api/products.js produces from real Supabase rows, so
 * swapping the data source requires no changes to any UI code.
 */

/** @typedef {import('../types/typedefs.js').ShopCategory} ShopCategory */
/** @typedef {import('../types/typedefs.js').Product} Product */

/** @type {ShopCategory[]} */
export const SAMPLE_CATEGORIES = [
  { slug: 'original-art', name: 'Original Art' },
  { slug: 'plants', name: 'Plants' },
  { slug: 'masks', name: 'Masks' },
  { slug: 'prints', name: 'Prints' },
  { slug: 'small-stuff', name: 'Small Stuff' },
];

const categoryBySlug = (slug) => SAMPLE_CATEGORIES.find((c) => c.slug === slug) || null;

const image = (filename, isPrimary = true) => ({
  url: `assets/images/gallery/full/${filename}`,
  isPrimary,
});

/** @type {Product[]} */
export const SAMPLE_PRODUCTS = [
  {
    id: 'sample-1',
    name: 'Recovered Specimen Painting No. 7',
    slug: 'recovered-specimen-painting-no-7',
    priceCents: 48000,
    shortDescription: 'Original acrylic painting, recovered-artifact series.',
    description: 'An original acrylic painting from the recovered-artifact series — framed and ready to hang.',
    category: categoryBySlug('original-art'),
    dimensions: '16in x 20in, framed',
    materials: 'Acrylic on panel, wood frame',
    quantity: 1,
    shippingClass: 'medium',
    pickupAvailable: true,
    featured: true,
    status: 'available',
    images: [image('specimen-005.jpg'), image('specimen-006.jpg', false)],
  },
  {
    id: 'sample-2',
    name: 'Abyssal Bloom Terrarium',
    slug: 'abyssal-bloom-terrarium',
    priceCents: 15000,
    shortDescription: 'Hand-sculpted alien plant specimen in a sealed terrarium.',
    description: 'A hand-sculpted alien plant specimen, mounted in a sealed glass terrarium for display.',
    category: categoryBySlug('plants'),
    dimensions: '6in diameter x 9in tall',
    materials: 'Sculpted resin, glass, foam substrate',
    quantity: 1,
    shippingClass: 'medium',
    pickupAvailable: false,
    featured: false,
    status: 'available',
    images: [image('specimen-012.jpg')],
  },
  {
    id: 'sample-3',
    name: 'Larval Mask No. 3',
    slug: 'larval-mask-no-3',
    priceCents: 32000,
    shortDescription: 'Wearable sculpted mask, hand-painted finish.',
    description: 'A wearable, hand-sculpted and hand-painted mask from the larval-form series. One of a kind.',
    category: categoryBySlug('masks'),
    dimensions: 'Fits most adult heads, 11in x 9in',
    materials: 'Sculpted foam latex, acrylic paint',
    quantity: 1,
    shippingClass: 'medium',
    pickupAvailable: true,
    featured: false,
    status: 'available',
    images: [image('specimen-018.jpg'), image('specimen-019.jpg', false)],
  },
  {
    id: 'sample-4',
    name: 'Specimen Archive Print Set',
    slug: 'specimen-archive-print-set',
    priceCents: 4500,
    shortDescription: 'Set of 3 archival prints from the specimen catalog.',
    description: 'A set of three archival-quality prints pulled from the specimen catalog. Unframed.',
    category: categoryBySlug('prints'),
    dimensions: '8in x 10in each',
    materials: 'Archival matte paper',
    quantity: 5,
    shippingClass: 'small',
    pickupAvailable: true,
    featured: false,
    status: 'available',
    images: [image('specimen-025.jpg')],
  },
  {
    id: 'sample-5',
    name: 'Resin Tooth Charm Pair',
    slug: 'resin-tooth-charm-pair',
    priceCents: 2200,
    shortDescription: 'Pair of small cast-resin specimen charms.',
    description: 'A pair of small cast-resin charms, finished to look like recovered biological artifacts.',
    category: categoryBySlug('small-stuff'),
    dimensions: '1in each',
    materials: 'Cast resin, waxed cord',
    quantity: 2,
    shippingClass: 'small',
    pickupAvailable: true,
    featured: false,
    status: 'available',
    images: [image('specimen-031.jpg')],
  },
  {
    id: 'sample-6',
    name: 'Fossilized Fragment Study',
    slug: 'fossilized-fragment-study',
    priceCents: 60000,
    shortDescription: 'Original sculpted fragment, sold.',
    description: 'An original sculpted fragment piece from an early museum-specimen study. No longer available.',
    category: categoryBySlug('original-art'),
    dimensions: '10in x 14in',
    materials: 'Sculpted resin, mixed media',
    quantity: 0,
    shippingClass: 'medium',
    pickupAvailable: false,
    featured: false,
    status: 'sold',
    images: [image('specimen-040.jpg')],
  },
  // The two entries below are intentionally non-public statuses, kept here
  // so the "published products only" filtering in api/products.js has
  // something real to exclude (and so tests can prove it does).
  {
    id: 'sample-7',
    name: 'Unfinished Creature Bust',
    slug: 'unfinished-creature-bust',
    priceCents: 0,
    shortDescription: 'Work in progress, not yet ready to list.',
    description: 'Still being sculpted — not ready for sale yet.',
    category: categoryBySlug('masks'),
    dimensions: '',
    materials: '',
    quantity: 1,
    shippingClass: 'medium',
    pickupAvailable: false,
    featured: false,
    status: 'draft',
    images: [],
  },
  {
    id: 'sample-8',
    name: 'Retired Process Print',
    slug: 'retired-process-print',
    priceCents: 3000,
    shortDescription: 'Previously listed print, taken down.',
    description: 'A print that was previously listed and has since been taken down.',
    category: categoryBySlug('prints'),
    dimensions: '8in x 10in',
    materials: 'Archival matte paper',
    quantity: 0,
    shippingClass: 'small',
    pickupAvailable: false,
    featured: false,
    status: 'hidden',
    images: [image('specimen-044.jpg')],
  },
];
