// E2E tests for the public shop and product pages.
// Uses the sample/prototype product data (src/features/shop/data/sample-products.js)
// since no real Supabase project is configured in this environment.
// Product detail is tested via the extensionless /product?slug=... form:
// `npx serve` (used for local/test hosting) 301-redirects /product.html?...
// to /product and drops the query string in the process, and it doesn't
// apply the Cloudflare _redirects rule that rewrites /product/:slug in
// production either. See docs/SHOP_SETUP.md.
const { test, expect } = require('@playwright/test');

test.describe('Shop page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/shop');
  });

  test('lists only published products, hiding drafts and unpublished items', async ({ page }) => {
    await expect(page.locator('.specimen-card').first()).toBeVisible();
    await expect(page.getByText('Unfinished Creature Bust')).toHaveCount(0);
    await expect(page.getByText('Retired Process Print')).toHaveCount(0);
  });

  test('shows price and status on cards, including a sold item', async ({ page }) => {
    const card = page.locator('.specimen-card', { hasText: 'Larval Mask No. 3' });
    await expect(card.locator('.specimen-price')).toContainText('$320.00');
    await expect(card.locator('.specimen-status')).toHaveText('Available');

    const soldCard = page.locator('.specimen-card', { hasText: 'Fossilized Fragment Study' });
    await expect(soldCard.locator('.specimen-status')).toHaveText('Sold');
  });

  test('filters products by category', async ({ page }) => {
    await page.getByRole('button', { name: 'Masks' }).click();
    await expect(page).toHaveURL(/category=masks/);
    await expect(page.locator('.specimen-card')).toHaveCount(1);
    await expect(page.locator('.specimen-card').first()).toContainText('Larval Mask No. 3');
  });

  test('product card links point to the pretty /product/:slug URL', async ({ page }) => {
    const link = page.locator('.specimen-title a', { hasText: 'Larval Mask No. 3' });
    await expect(link).toHaveAttribute('href', '/product/larval-mask-no-3');
  });
});

test.describe('Product page', () => {
  test('shows full detail for an available item', async ({ page }) => {
    await page.goto('/product?slug=larval-mask-no-3');
    await expect(page.locator('.specimen-name')).toHaveText('Larval Mask No. 3');
    await expect(page.locator('.product-price')).toContainText('$320.00');
    await expect(page.locator('.specimen-badge')).toHaveText('AVAILABLE');
    await expect(page.locator('#product-buy-btn')).toBeDisabled();
    await expect(page.locator('#product-buy-btn')).toHaveText('Add to Cart');
  });

  test('shows SOLD state and disables purchase for a sold item', async ({ page }) => {
    await page.goto('/product?slug=fossilized-fragment-study');
    await expect(page.locator('.specimen-badge')).toHaveText('SOLD');
    await expect(page.locator('#product-buy-btn')).toBeDisabled();
    await expect(page.locator('#product-buy-btn')).toHaveText('Sold');
  });

  test('shows a not-found state for an unknown slug', async ({ page }) => {
    await page.goto('/product?slug=does-not-exist');
    await expect(page.locator('.data-placeholder')).toContainText('could not be found');
  });

  test('draft products are not reachable even by direct slug', async ({ page }) => {
    await page.goto('/product?slug=unfinished-creature-bust');
    await expect(page.locator('.data-placeholder')).toContainText('could not be found');
  });
});

// Exhaustive per-product audit: every published sample product must behave
// identically. Guards against the exact failure mode reported in production
// (some products' shop-card link and detail-page lookup silently
// disagreeing while others worked) by checking every product, not a sample
// of one or two.
const ALL_PUBLISHED_PRODUCTS = [
  { slug: 'recovered-specimen-painting-no-7', name: 'Recovered Specimen Painting No. 7', price: '$480.00', badge: 'AVAILABLE' },
  { slug: 'abyssal-bloom-terrarium', name: 'Abyssal Bloom Terrarium', price: '$150.00', badge: 'AVAILABLE' },
  { slug: 'larval-mask-no-3', name: 'Larval Mask No. 3', price: '$320.00', badge: 'AVAILABLE' },
  { slug: 'specimen-archive-print-set', name: 'Specimen Archive Print Set', price: '$45.00', badge: 'AVAILABLE' },
  { slug: 'resin-tooth-charm-pair', name: 'Resin Tooth Charm Pair', price: '$22.00', badge: 'AVAILABLE' },
  { slug: 'fossilized-fragment-study', name: 'Fossilized Fragment Study', price: '$600.00', badge: 'SOLD' },
];

test.describe('Every published sample product', () => {
  for (const p of ALL_PUBLISHED_PRODUCTS) {
    test(`"${p.name}": card href, detail content, and refresh are all consistent`, async ({ page }) => {
      // Card href must point at the correct pretty URL.
      await page.goto('/shop');
      const link = page.locator('.specimen-title a', { hasText: p.name });
      await expect(link).toHaveAttribute('href', `/product/${p.slug}`);

      // Detail page (via the locally-testable query-string form; the pretty
      // /product/:slug path is covered by `wrangler pages dev` and live
      // verification, see docs/SHOP_SETUP.md) must render this exact product.
      await page.goto(`/product?slug=${p.slug}`);
      await expect(page.locator('.specimen-name')).toHaveText(p.name);
      await expect(page.locator('.product-price')).toContainText(p.price);
      await expect(page.locator('.specimen-badge')).toHaveText(p.badge);
      await expect(page.locator('.data-placeholder')).toHaveCount(0);

      // Hard refresh must render the same thing again, not a stale/blank state.
      await page.reload();
      await expect(page.locator('.specimen-name')).toHaveText(p.name);
    });
  }
});

test.describe('Shop nav visibility', () => {
  test('Shop is visible in the main nav on other pages, with no active state', async ({ page }) => {
    await page.goto('/gallery');
    // On narrow viewports nav-links is collapsed behind the hamburger toggle;
    // open it first so the link's own visibility is what's under test.
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

  test('Shop nav link is active on a product page', async ({ page }) => {
    await page.goto('/product?slug=larval-mask-no-3');
    await expect(page.locator('.nav-links a[href="shop.html"]')).toHaveClass(/active/);
  });
});
