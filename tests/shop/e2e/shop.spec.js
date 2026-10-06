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
