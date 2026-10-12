// E2E tests for the public /gallery page against the real, connected
// Supabase project (see docs/SHOP_SETUP.md). /gallery is now a two-tier
// Gallery Sections landing page (query-string routing: /gallery,
// /gallery?section=all, /gallery?section=<slug> — all one page/script,
// no duplicated HTML). Sections and images are managed through
// /admin → Gallery and can be empty, so these test structural/
// behavioral correctness rather than hardcoding specific content.
//
// These also tolerate supabase/migrations/004_gallery_sections.sql not
// having been run yet: gallery.js shows its generic error state (never a
// raw Supabase error) in that case, and every test below skips itself
// with a clear reason instead of failing — same pattern used throughout
// this suite since Stage 6.5.
const { test, expect } = require('@playwright/test');

async function loadOrSkip(t, page, path) {
  await page.goto(path, { waitUntil: 'networkidle' });
  const migrationPending = await page.locator('#gallery-status').filter({ hasText: 'Unable to load' }).count();
  t.skip(migrationPending > 0, 'supabase/migrations/004_gallery_sections.sql has not been run yet');
}

test.describe('Gallery landing (/gallery)', () => {
  test('loads without console errors and shows either sections or a clear empty state', async ({ page }, t) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loadOrSkip(t, page, '/gallery');
    const cardCount = await page.locator('.gallery-section-card').count();
    if (cardCount === 0) {
      await expect(page.locator('.shop-empty')).toBeVisible();
    } else {
      await expect(page.locator('.gallery-section-card').first()).toBeVisible();
      await expect(page.locator('.gallery-section-card').first().locator('.gallery-section-name')).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
  });

  test('no broken cover images', async ({ page }, t) => {
    await loadOrSkip(t, page, '/gallery');
    // Cover thumbnails now reserve their final box size upfront (fixed
    // aspect-ratio, no layout shift), so native `loading="lazy"` correctly
    // waits to fetch cards far below the fold until they're actually
    // scrolled near — scroll through first, like a real visitor would,
    // before checking that nothing that *has* loaded is broken.
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await page.waitForLoadState('networkidle');
    const broken = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.gallery-section-card img')).filter(
        (img) => !img.complete || img.naturalWidth === 0
      ).length
    );
    expect(broken).toBe(0);
  });

  test('a section card navigates to its own section view', async ({ page }, t) => {
    await loadOrSkip(t, page, '/gallery');
    const cardCount = await page.locator('.gallery-section-card').count();
    test.skip(cardCount === 0, 'no gallery sections currently published');

    const name = (await page.locator('.gallery-section-name').first().textContent()).trim();
    await page.locator('.gallery-section-card').first().click();
    await expect(page).toHaveURL(/\/gallery\?section=/);
    await expect(page.locator('#gallery-status')).toContainText(name.toUpperCase());
    await expect(page.locator('.gallery-back-link')).toBeVisible();
  });
});

test.describe('All Work (/gallery?section=all)', () => {
  test('loads without console errors and shows either items or a clear empty state', async ({ page }, t) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loadOrSkip(t, page, '/gallery?section=all');
    const itemCount = await page.locator('.gallery-item:not(.gallery-section-card)').count();
    if (itemCount === 0) {
      await expect(page.locator('.shop-empty')).toBeVisible();
    } else {
      await expect(page.locator('.gallery-item').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
    await expect(page.locator('.gallery-back-link')).toBeVisible();
  });

  test('lightbox opens, navigates, and closes (when items exist)', async ({ page }, t) => {
    await loadOrSkip(t, page, '/gallery?section=all');
    const itemCount = await page.locator('.gallery-item:not(.gallery-section-card)').count();
    test.skip(itemCount === 0, 'no "All Work" items currently published');

    await page.locator('.gallery-item').first().click();
    await expect(page.locator('#lightbox')).toHaveClass(/active/);
    if (itemCount > 1) {
      const firstSrc = await page.locator('#lightbox-image').getAttribute('src');
      await page.locator('.lightbox-next').click();
      await expect(page.locator('#lightbox-image')).not.toHaveAttribute('src', firstSrc);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).not.toHaveClass(/active/);
  });
});

test.describe('Unknown section', () => {
  test('an invalid/hidden section slug shows a graceful not-found state, not a crash or raw error', async ({ page }, t) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loadOrSkip(t, page, '/gallery?section=this-definitely-does-not-exist-12345');
    await expect(page.locator('.shop-empty')).toBeVisible();
    await expect(page.locator('.shop-empty')).toContainText('could not be found');
    expect(errors).toEqual([]);
  });
});
