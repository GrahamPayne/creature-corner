import { pickPrimaryImage } from './primaryImage.js';

/**
 * Builds the Shop landing page's category tiles from already-fetched
 * categories + products — no extra Supabase query, no new schema. A
 * category is included only if it has at least one publicly visible
 * product; getProducts() already only ever returns available/sold rows
 * (draft/hidden never leave the admin), so a category holding only drafts
 * is excluded automatically, with no draft/status logic duplicated here.
 * Ordering follows `categories` as given — already sorted by sort_order,
 * i.e. whatever Admin → Categories has configured — never re-sorted here.
 *
 * @param {{slug:string, name:string}[]} categories
 * @param {{category?:{slug:string}|null, images:{url:string,isPrimary:boolean}[], featured?:boolean}[]} products
 * @returns {{slug:string, name:string, count:number, coverUrl:string|null}[]}
 */
export function buildCategoryTiles(categories, products) {
  return categories
    .map((category) => {
      const inCategory = products.filter((p) => p.category?.slug === category.slug);
      if (inCategory.length === 0) return null;

      // Products already come back newest-first (see getProducts()).
      // Prefer a featured piece with a photo as the cover, then just the
      // newest piece with a photo, then the newest piece at all (no
      // photo — the tile falls back to the same placeholder product
      // cards use).
      const withImage = inCategory.filter((p) => pickPrimaryImage(p.images));
      const representative = withImage.find((p) => p.featured) || withImage[0] || inCategory[0];
      const cover = pickPrimaryImage(representative.images);

      return { slug: category.slug, name: category.name, count: inCategory.length, coverUrl: cover?.url ?? null };
    })
    .filter(Boolean);
}
