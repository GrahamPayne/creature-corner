// E2E tests for the public shop and product pages against the real,
// connected Supabase project (see docs/SHOP_SETUP.md). The products table
// is managed through /admin and can change at any time, so these test
// structural/behavioral correctness rather than hardcoding specific
// category names or product counts — except a couple of tests that only
// run when supabase/seed-sample-products.sql has been applied (they skip
// themselves with a clear reason otherwise).
//
// /shop is a category-overview landing page (one tile per category that
// currently has at least one publicly visible product) that drills into
// /shop?category=<slug> for that category's products — mirrors Gallery's
// /gallery -> /gallery?section=<slug> pattern. See
// src/features/shop/pages/shop.js and categoryTiles.js.
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qpnqrtcsxtcszmessbvx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ikmAu1n0PRFJgXjrOmvfog_3UBV57Km';

/** @returns {Promise<{slug:string, name:string}[]>} */
async function getLiveCategories() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await supabase.from('categories').select('slug, name').order('sort_order');
  return data || [];
}

/** Category slug -> count of publicly-visible (available/sold) products — the same rule categoryTiles.js applies. */
async function getLiveCategoryCounts() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await supabase
    .from('products')
    .select('category:categories(slug)')
    .in('status', ['available', 'sold']);
  const counts = new Map();
  for (const row of data || []) {
    const slug = row.category?.slug;
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return counts;
}

test.describe('Shop overview (/shop)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/shop', { waitUntil: 'networkidle' });
  });

  test('shows category tiles — or a clear empty state if nothing is published anywhere', async ({ page }) => {
    const tileCount = await page.locator('.shop-category-card').count();
    if (tileCount === 0) {
      await expect(page.locator('.shop-empty')).toBeVisible();
    } else {
      await expect(page.locator('.shop-category-card').first()).toBeVisible();
      await expect(page.locator('.shop-category-name').first()).not.toBeEmpty();
    }
  });

  test('shows exactly one tile per category that has publicly visible products — no more, no fewer', async ({ page }) => {
    const [categories, counts] = await Promise.all([getLiveCategories(), getLiveCategoryCounts()]);
    for (const { name, slug } of categories) {
      const tile = page.locator('.shop-category-card', { hasText: name });
      if (counts.has(slug)) {
        await expect(tile).toHaveCount(1);
        await expect(tile.locator('.shop-category-count')).toContainText(String(counts.get(slug)));
      } else {
        await expect(tile).toHaveCount(0);
      }
    }
  });

  test('tile order matches Admin → Categories sort order', async ({ page }) => {
    const [categories, counts] = await Promise.all([getLiveCategories(), getLiveCategoryCounts()]);
    const expectedOrder = categories.filter((c) => counts.has(c.slug)).map((c) => c.name);
    test.skip(expectedOrder.length === 0, 'no populated categories to check ordering against');

    const names = await page.locator('.shop-category-name').allTextContents();
    expect(names).toEqual(expectedOrder);
  });

  test('each tile is a real link to its category (direct-linkable, no client-side-only routing)', async ({ page }) => {
    const firstTile = page.locator('.shop-category-card').first();
    test.skip((await firstTile.count()) === 0, 'no populated categories currently exist');
    const href = await firstTile.getAttribute('href');
    expect(href).toMatch(/^\/shop\?category=[a-z0-9-]+$/);
  });

  test('never shows the draft/hidden test product names, anywhere a category is browsed', async ({ page }) => {
    // These two slugs only ever exist with status draft/hidden in this
    // dataset (see supabase/seed-sample-products.sql) — check the overview
    // (trivially true, no product names render there) and every currently
    // populated category page, since that's the only place a leaked draft
    // could actually surface.
    await expect(page.getByText('Unfinished Creature Bust')).toHaveCount(0);
    await expect(page.getByText('Retired Process Print')).toHaveCount(0);

    const counts = await getLiveCategoryCounts();
    for (const slug of counts.keys()) {
      await page.goto(`/shop?category=${slug}`, { waitUntil: 'networkidle' });
      await expect(page.getByText('Unfinished Creature Bust')).toHaveCount(0);
      await expect(page.getByText('Retired Process Print')).toHaveCount(0);
    }
  });
});

test.describe('Shop category view (/shop?category=...)', () => {
  test('clicking a tile opens that category and shows only its products', async ({ page }) => {
    await page.goto('/shop', { waitUntil: 'networkidle' });
    const firstTile = page.locator('.shop-category-card').first();
    test.skip((await firstTile.count()) === 0, 'no populated categories currently exist');

    const categoryName = (await firstTile.locator('.shop-category-name').textContent()).trim();
    const expectedCount = parseInt(await firstTile.locator('.shop-category-count').textContent(), 10);

    await firstTile.click();
    await expect(page).toHaveURL(/\/shop\?category=/);
    await page.waitForLoadState('networkidle');

    const cards = page.locator('.specimen-card');
    await expect(cards).toHaveCount(expectedCount);
    await expect(page.locator('#shop-status')).toContainText(categoryName.toUpperCase());

    // Back link returns to the overview, and browser back works too.
    await expect(page.locator('.shop-back-link')).toBeVisible();
  });

  test('direct link to a populated category works without going through the overview first', async ({ page }) => {
    const counts = await getLiveCategoryCounts();
    const [slug] = [...counts.keys()];
    test.skip(!slug, 'no populated categories currently exist');

    await page.goto(`/shop?category=${slug}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.shop-category-card')).toHaveCount(0);
    await expect(page.locator('.specimen-card').first()).toBeVisible();
    await expect(page.locator('.shop-back-link')).toBeVisible();
  });

  test('browser back button returns from a category view to the overview', async ({ page }) => {
    await page.goto('/shop', { waitUntil: 'networkidle' });
    const firstTile = page.locator('.shop-category-card').first();
    test.skip((await firstTile.count()) === 0, 'no populated categories currently exist');

    await firstTile.click();
    await page.waitForLoadState('networkidle');
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.locator('.shop-category-card').first()).toBeVisible();
  });

  test('an unknown or empty category slug shows a clear not-found state, not a dead/blank page', async ({ page }) => {
    await page.goto('/shop?category=definitely-does-not-exist-12345', { waitUntil: 'networkidle' });
    await expect(page.locator('.shop-empty')).toContainText('could not be found');
  });

  test('every visible product card has a valid price/status and a correct pretty-URL link', async ({ page }) => {
    const counts = await getLiveCategoryCounts();
    const [slug] = [...counts.keys()];
    test.skip(!slug, 'no populated categories currently exist');

    await page.goto(`/shop?category=${slug}`, { waitUntil: 'networkidle' });
    const cards = page.locator('.specimen-card');
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      await expect(card.locator('.specimen-price')).toContainText('$');
      await expect(card.locator('.specimen-status')).toHaveText(/Available|Sold/);
      const href = await card.locator('.specimen-title a').getAttribute('href');
      expect(href).toMatch(/^\/product\/[a-z0-9-]+$/);
    }
  });

  test('a product card inside a category links to a matching, working detail page', async ({ page }) => {
    const counts = await getLiveCategoryCounts();
    const [slug] = [...counts.keys()];
    test.skip(!slug, 'no populated categories currently exist');

    await page.goto(`/shop?category=${slug}`, { waitUntil: 'networkidle' });
    const firstCard = page.locator('.specimen-card').first();
    const name = await firstCard.locator('.specimen-title').textContent();
    const href = await firstCard.locator('.specimen-title a').getAttribute('href');
    const productSlug = href.split('/').pop();

    // `npx serve` (local/test hosting) doesn't apply the Cloudflare
    // _redirects rewrite for the pretty /product/:slug path — use the
    // extensionless query-string form instead, same as the rest of this file.
    await page.goto(`/product?slug=${productSlug}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.specimen-name')).toHaveText(name.trim());
    await expect(page.locator('.data-placeholder')).toHaveCount(0);
  });
});

test.describe('Product detail main image presentation', () => {
  test('shows the complete photograph uncropped (object-fit: contain), sized within the reduced bounds', async ({ page }) => {
    const counts = await getLiveCategoryCounts();
    const [slug] = [...counts.keys()];
    test.skip(!slug, 'no populated categories currently exist');

    await page.goto(`/shop?category=${slug}`, { waitUntil: 'networkidle' });
    const firstCard = page.locator('.specimen-card').first();
    const href = await firstCard.locator('.specimen-title a').getAttribute('href');
    const productSlug = href.split('/').pop();

    await page.goto(`/product?slug=${productSlug}`, { waitUntil: 'networkidle' });
    const img = page.locator('#product-main-image');
    test.skip((await img.count()) === 0, 'this product has no image to check');

    await page.waitForFunction(() => {
      const el = document.getElementById('product-main-image');
      return el && el.complete && el.naturalWidth > 0;
    });

    // object-fit: contain (not the listing-card cover/crop treatment) is
    // what actually guarantees nothing gets cropped.
    const objectFit = await img.evaluate((el) => getComputedStyle(el).objectFit);
    expect(objectFit).toBe('contain');

    const box = await img.boundingBox();
    const natural = await img.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));

    // contain never crops, but a mismatched container could still visually
    // squash the image — the rendered box's aspect ratio must match the
    // source photo's own aspect ratio (small tolerance for subpixel rounding).
    const renderedRatio = box.width / box.height;
    const naturalRatio = natural.w / natural.h;
    expect(Math.abs(renderedRatio - naturalRatio)).toBeLessThan(0.05);

    // ~20-25% smaller than the old fixed 800px-wide box.
    expect(box.width).toBeLessThanOrEqual(600);
    expect(box.height).toBeLessThanOrEqual(500);
  });
});

test.describe('Product page', () => {
  test('shows a not-found state for an unknown slug', async ({ page }) => {
    await page.goto('/product?slug=definitely-does-not-exist-12345');
    await expect(page.locator('.data-placeholder')).toContainText('could not be found');
  });

  test('draft products are not reachable even by direct slug', async ({ page }) => {
    await page.goto('/product?slug=unfinished-creature-bust');
    await expect(page.locator('.data-placeholder')).toContainText('could not be found');
  });
});

// Only meaningful once supabase/seed-sample-products.sql has been run —
// skips itself cleanly otherwise rather than failing.
test.describe('Seeded sample products (optional)', () => {
  test('Larval Mask No. 3 shows full available-product detail', async ({ page }) => {
    await page.goto('/product?slug=larval-mask-no-3', { waitUntil: 'networkidle' });
    const notFound = await page.locator('.data-placeholder').count();
    test.skip(notFound > 0, 'supabase/seed-sample-products.sql has not been run yet');

    await expect(page.locator('.specimen-name')).toHaveText('Larval Mask No. 3');
    await expect(page.locator('.product-price')).toContainText('$320.00');
    await expect(page.locator('.specimen-badge')).toHaveText('AVAILABLE');
  });

  test('Fossilized Fragment Study shows SOLD and disables purchase', async ({ page }) => {
    await page.goto('/product?slug=fossilized-fragment-study', { waitUntil: 'networkidle' });
    const notFound = await page.locator('.data-placeholder').count();
    test.skip(notFound > 0, 'supabase/seed-sample-products.sql has not been run yet');

    await expect(page.locator('.specimen-badge')).toHaveText('SOLD');
    await expect(page.locator('#product-buy-btn')).toBeDisabled();
    await expect(page.locator('#product-buy-btn')).toHaveText('Sold');
  });
});

test.describe('Shop nav visibility', () => {
  test('Shop is visible in the main nav on other pages, with no active state', async ({ page }) => {
    await page.goto('/gallery');
    const toggle = page.locator('.nav-toggle');
    if (await toggle.isVisible()) await toggle.click();
    const shopLink = page.locator('.nav-links a[href="shop.html"]');
    await expect(shopLink).toBeVisible();
    await expect(shopLink).not.toHaveClass(/active/);
  });

  test('Shop nav link is active on the shop page', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.locator('.nav-links a[href="shop.html"]')).toHaveClass(/active/);
  });
});
