// Playwright config for e2e tests across the site's feature folders.
// The site is static; `npx serve` hosts the repo root with clean URLs,
// so /field-guide resolves to field-guide.html (same as production).
// Note: `npx serve` does not understand the Cloudflare _redirects file, and
// it 301-redirects /product.html?... to /product (dropping the query
// string), so shop tests hit the extensionless /product?slug=... form
// instead of /product/:slug (see docs/SHOP_SETUP.md).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3199',
  },
  webServer: {
    command: 'npx serve -l 3199 .',
    url: 'http://localhost:3199/field-guide',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
