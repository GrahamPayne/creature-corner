// E2E tests for the public /gallery page against the real, connected
// Supabase project (see docs/SHOP_SETUP.md). Gallery content is managed
// through /admin → Gallery (this stage) and can be empty, so these test
// structural/behavioral correctness rather than hardcoding specific
// image counts or content.
//
// These also tolerate supabase/migrations/003_gallery.sql not having been
// run yet in whatever environment this suite is pointed at: in that case
// gallery.js correctly shows its error state (never a raw Supabase error),
// and every test below skips itself with a clear reason instead of
// failing — same pattern as the live unit tests in gallery.test.mjs.
const { test, expect } = require('@playwright/test');

async function loadGalleryOrSkip(t, page) {
  await page.goto('/gallery', { waitUntil: 'networkidle' });
  const migrationPending = await page.locator('#gallery-status').filter({ hasText: 'Unable to load' }).count();
  t.skip(migrationPending > 0, 'supabase/migrations/003_gallery.sql has not been run yet');
}

test.describe('Gallery page', () => {
  test('loads without console errors and shows either images or a clear empty state', async ({ page }, t) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loadGalleryOrSkip(t, page);
    const itemCount = await page.locator('.gallery-item').count();
    if (itemCount === 0) {
      await expect(page.locator('.shop-empty')).toBeVisible();
    } else {
      await expect(page.locator('.gallery-item').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('archive status reflects the real item count, not a hardcoded number', async ({ page }, t) => {
    await loadGalleryOrSkip(t, page);
    const itemCount = await page.locator('.gallery-item').count();
    await expect(page.locator('#gallery-status')).toContainText(`${itemCount} DOCUMENTED`);
  });

  test('no broken images in the grid', async ({ page }, t) => {
    await loadGalleryOrSkip(t, page);
    const broken = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.gallery-item img')).filter(
        (img) => !img.complete || img.naturalWidth === 0
      ).length
    );
    expect(broken).toBe(0);
  });

  test('lightbox opens on click, navigates, and closes (when images exist)', async ({ page }, t) => {
    await loadGalleryOrSkip(t, page);
    const itemCount = await page.locator('.gallery-item').count();
    test.skip(itemCount === 0, 'no gallery images currently published');

    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#lightbox')).toHaveClass(/active/);
    await expect(page.locator('#lightbox-image')).toHaveAttribute('src', /.+/);

    if (itemCount > 1) {
      const firstSrc = await page.locator('#lightbox-image').getAttribute('src');
      await page.locator('.lightbox-next').click();
      await expect(page.locator('#lightbox-image')).not.toHaveAttribute('src', firstSrc);
    }

    await page.locator('.lightbox-close').click();
    await expect(page.locator('#lightbox')).not.toHaveClass(/active/);
  });

  test('closes the lightbox on Escape', async ({ page }, t) => {
    await loadGalleryOrSkip(t, page);
    const itemCount = await page.locator('.gallery-item').count();
    test.skip(itemCount === 0, 'no gallery images currently published');

    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#lightbox')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).not.toHaveClass(/active/);
  });
});
