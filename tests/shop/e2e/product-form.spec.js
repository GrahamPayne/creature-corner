// Regression coverage for the decimal shipping-weight/dimension bug: the
// packed-weight-oz and packed-dimension <input type="number"> fields used
// step="1"/"0.1", HTML5 constraints that reject values off that exact grid
// (0.76, 1.46, etc.) — the real cause of the browser's "nearest valid
// values are X and Y" error, not a JS/database issue. Fixed to step="any".
//
// This drives the REAL createProductForm() component (the one Admin →
// Products → Edit Product renders) in Edit-Product mode, not a
// reimplementation — via a standalone harness (fixtures/product-form-
// harness.html) with a stubbed onSubmit, since authenticated admin flows
// aren't reachable from this suite (no test credentials — see
// admin.spec.js).
const { test, expect } = require('@playwright/test');

// No .html suffix — see batch-upload.spec.js's identical note: `serve`
// 301-redirects *.html requests to the extensionless clean-URL form, which
// page.goto() doesn't follow into a loaded module context.
const HARNESS_URL = '/tests/shop/e2e/fixtures/product-form-harness';

test.describe('Edit Product form — decimal weight/dimension validation (offline harness)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => window.__formReady === true);
  });

  test('accepts the exact reported values (0.76 oz, 1.30/1.46/2.76 in) and Save Changes proceeds', async ({ page }) => {
    const weightOz = page.locator('input[name="packedWeightOz"]');
    const length = page.locator('input[name="packageLengthIn"]');
    const width = page.locator('input[name="packageWidthIn"]');
    const height = page.locator('input[name="packageHeightIn"]');

    await weightOz.fill('0.76');
    await length.fill('1.30');
    await width.fill('1.46');
    await height.fill('2.76');

    // checkValidity() is the browser's own HTML5 constraint check — this is
    // exactly what used to fail ("the two nearest valid values are 1.4 and
    // 1.5" for Width). step="any" removes the step-mismatch constraint
    // entirely; min="0" still blocks negatives (covered below).
    for (const [label, input] of [['weightOz', weightOz], ['length', length], ['width', width], ['height', height]]) {
      expect(await input.evaluate((el) => el.checkValidity()), `${label} should be valid`).toBe(true);
    }

    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.__events.some((e) => e.type === 'submit'), null, { timeout: 5_000 });

    const events = await page.evaluate(() => window.__events);
    const submitted = events.find((e) => e.type === 'submit');
    expect(submitted, 'Save Changes must call onSubmit — a blocked/failed validation would mean no submit event').toBeTruthy();

    // The exact decimals must reach onSubmit's fields — not rounded, not
    // truncated, not coerced to the old step grid.
    expect(submitted.fields.packedWeightOz).toBe(0.76);
    expect(submitted.fields.packageLengthIn).toBe(1.3);
    expect(submitted.fields.packageWidthIn).toBe(1.46);
    expect(submitted.fields.packageHeightIn).toBe(2.76);
  });

  test('packedWeightLb also accepts a fractional value', async ({ page }) => {
    const weightLb = page.locator('input[name="packedWeightLb"]');
    await weightLb.fill('1.25');
    expect(await weightLb.evaluate((el) => el.checkValidity())).toBe(true);
  });

  test('quantity remains a whole-number field and rejects a negative value', async ({ page }) => {
    const qty = page.locator('input[name="quantity"]');
    await qty.fill('-2');
    expect(await qty.evaluate((el) => el.checkValidity())).toBe(false);

    await qty.fill('3');
    expect(await qty.evaluate((el) => el.checkValidity())).toBe(true);
  });

  test('negative weight/dimension values are still rejected', async ({ page }) => {
    const weightOz = page.locator('input[name="packedWeightOz"]');
    await weightOz.fill('-0.5');
    expect(await weightOz.evaluate((el) => el.checkValidity())).toBe(false);

    const width = page.locator('input[name="packageWidthIn"]');
    await width.fill('-1.46');
    expect(await width.evaluate((el) => el.checkValidity())).toBe(false);
  });

  test('non-numeric text cannot be entered into a number field at all', async ({ page }) => {
    const width = page.locator('input[name="packageWidthIn"]');
    // type="number" rejects non-numeric text so completely that Playwright's
    // own .fill() refuses to even attempt it — a stronger guarantee than a
    // validation message, there's no way for invalid text to reach the
    // field's value in the first place.
    await expect(width.fill('abc')).rejects.toThrow(/Cannot type text into input\[type=number\]/);
    expect(await width.inputValue()).toBe('');
  });
});
