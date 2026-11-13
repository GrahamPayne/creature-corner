// Regression coverage for the Batch Upload "frozen on Starting…" bug:
// startSubmission() used to call renderProgress() (which ends by reading
// runner.getSummary()) *before* `runner` was assigned, so it threw with
// runner still null and runner.run() — and therefore every createOne() call —
// was never reached. Every item sat at "Pending" forever and nothing was
// ever sent to Supabase.
//
// This can't be tested against the real admin page: authenticated admin
// flows aren't reachable from this suite (no test credentials — see
// admin.spec.js). Instead this loads a standalone harness
// (fixtures/batch-upload-harness.html) that imports the real
// createBatchUpload() module and supplies fake onCreateProduct/onUploadImage
// callbacks, so the actual submission/progress/retry code runs in a real
// browser with no Supabase/network/auth involved at all.
const { test, expect } = require('@playwright/test');

// No .html suffix: `serve` (this suite's local dev server) 301-redirects any
// *.html request to its extensionless clean-URL form — same convention every
// real page on this site relies on (see playwright.config.js) — and
// page.goto() doesn't follow that redirect into a loaded module context, so
// requesting the clean URL directly is required, not just stylistic.
const HARNESS_URL = '/tests/shop/e2e/fixtures/batch-upload-harness';

function fakeImage(name) {
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
}

test.describe('Batch Upload — offline harness (no Supabase)', () => {
  test('submits every selected image as its own product and reaches a completed summary', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    await page.setInputFiles('#batch-file-input', [fakeImage('a.jpg'), fakeImage('b.jpg'), fakeImage('c.jpg')]);
    await page.fill('#shared-nameBase', 'Creature Lighter');
    await page.fill('#shared-priceCents', '25');
    await page.selectOption('#shared-categoryId', 'cat-1');

    await page.click('#batch-submit-btn');

    // The actual regression: this used to stay "Starting…" forever.
    await expect(page.locator('#batch-progress-summary')).toContainText('3 of 3 products created successfully', { timeout: 10_000 });
    await expect(page.locator('.admin-batch-progress-row[data-status="done"]')).toHaveCount(3);
    await expect(page.locator('#batch-finish-btn')).toBeEnabled();

    expect(errors).toEqual([]);

    const creates = await page.evaluate(() => window.__calls.creates);
    expect(creates).toHaveLength(3);
    expect(creates.map((f) => f.name).sort()).toEqual(['Creature Lighter-001', 'Creature Lighter-002', 'Creature Lighter-003']);
    expect(creates.every((f) => f.status === 'draft')).toBe(true);

    const uploads = await page.evaluate(() => window.__calls.uploads);
    expect(uploads).toHaveLength(3);
  });

  test('continues the sequence from the highest existing product number', async ({ page }) => {
    await page.addInitScript(() => {
      window.__TEST_CONFIG__ = {
        existingProducts: [{ name: 'Creature Lighter-001' }, { name: 'Creature Lighter-030' }, { name: 'Unrelated Product' }],
      };
    });
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    await page.setInputFiles('#batch-file-input', [fakeImage('a.jpg'), fakeImage('b.jpg')]);
    await page.fill('#shared-nameBase', 'Creature Lighter');
    await expect(page.locator('#batch-naming-preview')).toContainText('Creature Lighter-031');

    await page.fill('#shared-priceCents', '25');
    await page.selectOption('#shared-categoryId', 'cat-1');
    await page.click('#batch-submit-btn');

    await expect(page.locator('#batch-progress-summary')).toContainText('2 of 2 products created successfully', { timeout: 10_000 });
    const creates = await page.evaluate(() => window.__calls.creates);
    expect(creates.map((f) => f.name).sort()).toEqual(['Creature Lighter-031', 'Creature Lighter-032']);
  });

  test('retrying a failed image upload does not recreate the product that already succeeded', async ({ page }) => {
    await page.addInitScript(() => {
      window.__TEST_CONFIG__ = { failUploadOnceForProductId: 'product-1' };
    });
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    await page.setInputFiles('#batch-file-input', [fakeImage('a.jpg'), fakeImage('b.jpg')]);
    await page.fill('#shared-nameBase', 'Creature Lighter');
    await page.fill('#shared-priceCents', '25');
    await page.selectOption('#shared-categoryId', 'cat-1');

    await page.click('#batch-submit-btn');
    await expect(page.locator('#batch-progress-summary')).toContainText('1 of 2', { timeout: 10_000 });
    await expect(page.locator('.admin-batch-progress-row[data-status="failed"]')).toHaveCount(1);
    await expect(page.locator('.admin-batch-progress-error')).toContainText('was created, but its photo failed to upload');

    await page.click('#batch-retry-btn');
    await expect(page.locator('#batch-progress-summary')).toContainText('2 of 2 products created successfully', { timeout: 10_000 });
    await expect(page.locator('.admin-batch-progress-row[data-status="done"]')).toHaveCount(2);

    // The product row that already succeeded must not be re-created by the retry.
    const creates = await page.evaluate(() => window.__calls.creates);
    expect(creates).toHaveLength(2);
  });

  test('an error validating during submission shows a visible message, never a silent freeze', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    await page.setInputFiles('#batch-file-input', [fakeImage('a.jpg')]);
    await page.fill('#shared-priceCents', '25');
    await page.selectOption('#shared-categoryId', 'cat-1');
    // No shared name entered and no per-card name set — every item is nameless.
    await page.click('#batch-submit-btn');

    await expect(page.locator('#batch-validation-error')).toBeVisible();
    await expect(page.locator('#batch-validation-error')).toContainText('needs a name');
    // Must still be on the editing view, not a frozen progress screen.
    await expect(page.locator('#batch-submit-btn')).toBeVisible();
  });

  test('the shared packed-weight-oz field accepts a fractional value like 0.76 (decimal weight fix)', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    const ozInput = page.locator('#shared-packedWeightOz');
    await ozInput.fill('0.76');
    // checkValidity() is the browser's own HTML5 constraint check — this is
    // exactly what used to fail with step="1" ("the two nearest valid
    // values are 0 and 1"). step="any" removes that constraint entirely.
    expect(await ozInput.evaluate((el) => el.checkValidity())).toBe(true);

    await page.setInputFiles('#batch-file-input', [fakeImage('a.jpg')]);
    await page.fill('#shared-nameBase', 'Creature Lighter');
    await page.fill('#shared-priceCents', '25');
    await page.selectOption('#shared-categoryId', 'cat-1');
    await page.click('#batch-submit-btn');

    await expect(page.locator('#batch-progress-summary')).toContainText('1 of 1 product created successfully', { timeout: 10_000 });
    const creates = await page.evaluate(() => window.__calls.creates);
    // The exact decimal must survive into the created product's fields —
    // not rounded, not truncated.
    expect(creates[0].packedWeightOz).toBe(0.76);
  });

  test('a per-item packed-weight-oz override also accepts fractional values', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    await page.setInputFiles('#batch-file-input', [fakeImage('a.jpg')]);
    await page.fill('#shared-nameBase', 'Creature Lighter');
    await page.fill('#shared-priceCents', '25');
    await page.selectOption('#shared-categoryId', 'cat-1');

    await page.click('[data-act="expand"]');
    const ozOverride = page.locator('[data-field="packedWeightOz"]');
    await ozOverride.fill('1.25');
    expect(await ozOverride.evaluate((el) => el.checkValidity())).toBe(true);

    await page.click('#batch-submit-btn');
    await expect(page.locator('#batch-progress-summary')).toContainText('1 of 1 product created successfully', { timeout: 10_000 });
    const creates = await page.evaluate(() => window.__calls.creates);
    expect(creates[0].packedWeightOz).toBe(1.25);
  });

  test('quantity remains a whole-number field and still rejects a negative value', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__batchReady === true);

    const qtyInput = page.locator('#shared-quantity');
    await qtyInput.fill('-3');
    expect(await qtyInput.evaluate((el) => el.checkValidity())).toBe(false);

    const ozInput = page.locator('#shared-packedWeightOz');
    await ozInput.fill('-1.5');
    expect(await ozInput.evaluate((el) => el.checkValidity())).toBe(false);
  });
});
