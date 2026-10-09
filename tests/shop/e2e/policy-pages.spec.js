// E2E tests for the Stage 6.75 policy pages (Shipping / Returns / Privacy /
// Terms) — static content, no Supabase dependency, so these are plain
// structural/content checks rather than live-data tests.
const { test, expect } = require('@playwright/test');

const PAGES = [
  { path: '/shipping', heading: 'Shipping & Local Pickup' },
  { path: '/returns', heading: 'Returns & Damage Policy' },
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Service' },
];

for (const { path, heading } of PAGES) {
  test(`${path} loads with the right heading, contact email, and no console errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveText(heading);
    await expect(page.locator('a[href="mailto:creaturecornerart@gmail.com"]').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${path} footer links to the other policy pages`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    const footerPolicyLinks = page.locator('.footer-policy-links a');
    await expect(footerPolicyLinks).toHaveCount(4);
    for (const href of ['/shipping', '/returns', '/privacy', '/terms']) {
      await expect(page.locator(`.footer-policy-links a[href="${href}"]`)).toBeVisible();
    }
  });
}

for (const { path } of PAGES) {
  test(`mobile: ${path} has no horizontal scroll`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile');
    await page.goto(path, { waitUntil: 'networkidle' });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, 'page is wider than the viewport — horizontal scroll').toBeLessThanOrEqual(clientWidth + 1);
  });
}

test('policy links are reachable from another page (shop) and not in the primary nav', async ({ page }) => {
  await page.goto('/shop', { waitUntil: 'networkidle' });
  await expect(page.locator('.footer-policy-links a[href="/privacy"]')).toBeVisible();
  // Primary nav only has the existing site sections — policy links must not clutter it.
  await expect(page.locator('.nav-links a[href="/privacy"], .nav-links a[href="privacy.html"]')).toHaveCount(0);

  await page.click('.footer-policy-links a[href="/privacy"]');
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator('h1')).toHaveText('Privacy Policy');
});
