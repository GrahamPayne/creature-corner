// E2E tests for /admin. Supabase is not configured in this test environment
// (src/features/shop/api/config.js still has placeholder values), so the
// only state reachable here is the "not configured" guard — that's
// intentional and matches production until real credentials are wired in.
// Login/dashboard/CRUD flows get covered once a real Supabase project exists.
const { test, expect } = require('@playwright/test');

test('admin page shows a clear message when Supabase is not configured, not a broken login form', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/admin');
  await expect(page.locator('.admin-notice')).toContainText("isn't connected");
  await expect(page.locator('#login-form')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('admin page is not linked from the public nav', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.locator('a[href="admin.html"]')).toHaveCount(0);
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
});
