// Playwright config for the Field Guide prototype e2e tests.
// The site is static; `npx serve` hosts the repo root with clean URLs,
// so /field-guide resolves to field-guide.html (same as production).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/field-guide/e2e',
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
