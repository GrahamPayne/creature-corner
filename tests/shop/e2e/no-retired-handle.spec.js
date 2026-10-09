// Regression guard: @cr3aturecorner (the retired Instagram handle) was
// removed from the site twice already (see git history) — this keeps it
// from quietly coming back a third time. Checks the rendered page text,
// not just source, so it also catches anything JS might reintroduce.
const { test, expect } = require('@playwright/test');

const PAGES = ['/', '/shop', '/about', '/contact', '/gallery', '/exhibition', '/commissions', '/shipping', '/returns', '/privacy', '/terms'];

for (const path of PAGES) {
  test(`${path} never mentions the retired @cr3aturecorner handle`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    const html = await page.content();
    expect(html.toLowerCase()).not.toContain('cr3aturecorner');
  });
}

test('the current Instagram handle (@grahampayne24) is present on the homepage', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const html = await page.content();
  expect(html).toContain('grahampayne24');
});
