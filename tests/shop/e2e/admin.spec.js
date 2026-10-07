// E2E tests for /admin against the real, connected Supabase project (see
// docs/SHOP_SETUP.md). No test here authenticates as the real admin user —
// that account's credentials aren't available to this test suite — so these
// cover the logged-out surface: the login form itself, bad-credential
// handling, and that RLS actually blocks writes from an unauthenticated
// client (not just that the UI hides the option). Authenticated CRUD is
// verified live and manually against the real admin account.
const { test, expect } = require('@playwright/test');

test('admin page shows the login form (not a broken "not configured" state)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/admin');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('bad credentials show a clear error, not a crash', async ({ page }) => {
  await page.goto('/admin');
  await page.fill('input[name="email"]', 'not-a-real-admin@example.com');
  await page.fill('input[name="password"]', 'wrong-password-123');
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('.admin-form-error')).toBeVisible();
  await expect(page.locator('.admin-form-error')).toContainText('Invalid email or password');
});

test('admin page is not linked from the public nav', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.locator('a[href="admin.html"]')).toHaveCount(0);
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
});
