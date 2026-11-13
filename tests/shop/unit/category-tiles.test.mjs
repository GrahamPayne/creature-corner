import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCategoryTiles } from '../../../src/features/shop/categoryTiles.js';

function product(overrides) {
  return { category: null, images: [], featured: false, ...overrides };
}

test('excludes categories with no products', () => {
  const categories = [{ slug: 'masks', name: 'Masks' }, { slug: 'plants', name: 'Plants' }];
  const products = [product({ category: { slug: 'masks' } })];
  const tiles = buildCategoryTiles(categories, products);
  assert.deepEqual(tiles.map((t) => t.slug), ['masks']);
});

test('keeps categories in the given order (already admin sort_order upstream)', () => {
  const categories = [{ slug: 'b', name: 'B' }, { slug: 'a', name: 'A' }];
  const products = [product({ category: { slug: 'a' } }), product({ category: { slug: 'b' } })];
  const tiles = buildCategoryTiles(categories, products);
  assert.deepEqual(tiles.map((t) => t.slug), ['b', 'a']);
});

test('counts only products actually in that category', () => {
  const categories = [{ slug: 'masks', name: 'Masks' }];
  const products = [
    product({ category: { slug: 'masks' } }),
    product({ category: { slug: 'masks' } }),
    product({ category: { slug: 'plants' } }),
  ];
  const tiles = buildCategoryTiles(categories, products);
  assert.equal(tiles[0].count, 2);
});

test('prefers a featured product with an image as the cover', () => {
  const categories = [{ slug: 'masks', name: 'Masks' }];
  const products = [
    product({ category: { slug: 'masks' }, images: [{ url: 'plain.jpg', isPrimary: true }] }),
    product({ category: { slug: 'masks' }, featured: true, images: [{ url: 'featured.jpg', isPrimary: true }] }),
  ];
  const tiles = buildCategoryTiles(categories, products);
  assert.equal(tiles[0].coverUrl, 'featured.jpg');
});

test('falls back to the newest product with an image when none are featured', () => {
  // getProducts() orders newest-first, so index 0 here simulates "newest".
  const categories = [{ slug: 'masks', name: 'Masks' }];
  const products = [
    product({ category: { slug: 'masks' }, images: [{ url: 'newest.jpg', isPrimary: true }] }),
    product({ category: { slug: 'masks' }, images: [] }),
  ];
  const tiles = buildCategoryTiles(categories, products);
  assert.equal(tiles[0].coverUrl, 'newest.jpg');
});

test('coverUrl is null (placeholder tile) when nothing in the category has an image', () => {
  const categories = [{ slug: 'masks', name: 'Masks' }];
  const products = [product({ category: { slug: 'masks' }, images: [] })];
  const tiles = buildCategoryTiles(categories, products);
  assert.equal(tiles[0].coverUrl, null);
});

test('a category with no public products (e.g. only drafts, already filtered out upstream) produces no tile', () => {
  // buildCategoryTiles trusts `products` to already be public-only (getProducts()
  // only ever returns available/sold) — an empty products list for a real
  // category is exactly what "only drafts exist" looks like by the time it
  // reaches this function.
  const categories = [{ slug: 'masks', name: 'Masks' }];
  assert.deepEqual(buildCategoryTiles(categories, []), []);
});

test('multiple categories each get their own independent tile', () => {
  const categories = [{ slug: 'masks', name: 'Masks' }, { slug: 'plants', name: 'Plants' }, { slug: 'prints', name: 'Prints' }];
  const products = [
    product({ category: { slug: 'masks' } }),
    product({ category: { slug: 'plants' } }),
    product({ category: { slug: 'plants' } }),
  ];
  const tiles = buildCategoryTiles(categories, products);
  assert.deepEqual(
    tiles.map((t) => [t.slug, t.count]),
    [['masks', 1], ['plants', 2]]
  );
});
