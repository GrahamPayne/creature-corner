// E2E tests for the public shop and product pages against the real,
// connected Supabase project (see docs/SHOP_SETUP.md). The products table
// is managed through /admin and can be empty or change at any time, so
// these test structural/behavioral correctness rather than hardcoding
// specific product counts or content — except for a couple of tests that
// only run when supabase/seed-sample-products.sql has been applied (they
// skip themselves with a clear reason otherwise).
const { test, expect } = require('@playwright/test');

test.describe('Shop page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/shop');
  });

  test('loads without error and shows either products or a clear empty state', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    const cardCount = await page.locator('.specimen-card').count();
    if (cardCount === 0) {
      await expect(page.locator('.shop-empty')).toBeVisible();
    } else {
      await expect(page.locator('.specimen-card').first()).toBeVisible();
    }
  });

  test('never shows draft or hidden test products', async ({ page }) => {
    // These two slugs only ever exist with status draft/hidden in this
    // dataset (see supabase/seed-sample-products.sql, which deliberately
    // does not seed them) — if either ever appears, RLS or the status
    // filter has regressed.
    await expect(page.getByText('Unfinished Creature Bust')).toHaveCount(0);
    await expect(page.getByText('Retired Process Print')).toHaveCount(0);
  });

  test('every visible card has a valid price and status, and a correct pretty-URL link', async ({ page }) => {
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

  test('category filter buttons reflect the 5 seeded categories', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    for (const name of ['Original Art', 'Plants', 'Masks', 'Prints', 'Small Stuff']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
  });

  test('clicking a card (if any exist) opens a matching, working detail page', async ({ page }) => {
    const firstCard = page.locator('.specimen-card').first();
    test.skip((await firstCard.count()) === 0, 'no products currently published — nothing to click');

    const name = await firstCard.locator('.specimen-title').textContent();
    await firstCard.locator('.specimen-title a').click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toMatch(/\/product\/[a-z0-9-]+$/);
    await expect(page.locator('.specimen-name')).toHaveText(name.trim());
    await expect(page.locator('.data-placeholder')).toHaveCount(0);
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
    await page.goto('/product?slug=larval-mask-no-3');
    const notFound = await page.locator('.data-placeholder').count();
    test.skip(notFound > 0, 'supabase/seed-sample-products.sql has not been run yet');

    await expect(page.locator('.specimen-name')).toHaveText('Larval Mask No. 3');
    await expect(page.locator('.product-price')).toContainText('$320.00');
    await expect(page.locator('.specimen-badge')).toHaveText('AVAILABLE');
  });

  test('Fossilized Fragment Study shows SOLD and disables purchase', async ({ page }) => {
    await page.goto('/product?slug=fossilized-fragment-study');
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
