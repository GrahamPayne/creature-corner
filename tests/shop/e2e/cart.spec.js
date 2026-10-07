// E2E tests for the cart/checkout-review flow against the real, connected
// Supabase project (see docs/SHOP_SETUP.md). Each Playwright test gets a
// fresh browser context, so localStorage (and therefore the cart) starts
// empty every time — no manual cleanup needed between tests.
//
// Deliberately does NOT hardcode a product slug/name: you're actively
// testing the admin yourself between runs (renaming, duplicating, deleting
// test products), so any fixed slug goes stale fast. Instead each test
// looks up whatever real, available, in-stock product currently exists and
// builds its assertions from that product's actual fields, and skips
// itself cleanly if the shop is currently empty.
//
// Sold/hidden/deleted-product blocking isn't exercised here since that
// requires changing live product state, which needs an authenticated admin
// session this suite doesn't have — see the live manual verification notes.
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qpnqrtcsxtcszmessbvx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ikmAu1n0PRFJgXjrOmvfog_3UBV57Km';

/** @returns {Promise<any|null>} the first available, in-stock product (camelCase-ish raw row), or null if the shop is empty */
async function getLiveTestProduct() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'available')
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function addProductToCart(page, slug) {
  await page.goto(`/product?slug=${slug}`, { waitUntil: 'networkidle' });
  await page.click('#product-buy-btn');
}

test('empty cart shows a clear empty state, not a crash', async ({ page }) => {
  await page.goto('/cart', { waitUntil: 'networkidle' });
  await expect(page.locator('.shop-empty')).toContainText('empty');
  await expect(page.locator('a[href="/shop"]')).toBeVisible();
});

test('nav cart badge is empty with no items', async ({ page }) => {
  await page.goto('/shop', { waitUntil: 'networkidle' });
  await expect(page.locator('#nav-cart-count')).toHaveText('');
});

test('add to cart from product page updates the nav badge and persists to /cart', async ({ page }, testInfo) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await expect(page.locator('#nav-cart-count')).toHaveText('(1)');
  await expect(page.locator('#product-buy-note')).toContainText('Added to cart');

  await page.goto('/cart', { waitUntil: 'networkidle' });
  await expect(page.locator('.cart-item-name')).toHaveText(product.name);
  await expect(page.locator('#nav-cart-count')).toHaveText('(1)');
});

test('cart price matches the live product price, not anything cached client-side', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });
  const expectedPrice = (product.price_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  await expect(page.locator('.cart-item-price')).toContainText(expectedPrice);
});

test('cart survives a hard refresh', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });
  await expect(page.locator('.cart-item-name')).toHaveText(product.name);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.cart-item-name')).toHaveText(product.name);
  await expect(page.locator('#nav-cart-count')).toHaveText('(1)');
});

test('quantity stepper respects live available stock', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  await expect(page.locator('.cart-qty-value')).toHaveText('1');
  if (product.quantity <= 1) {
    await expect(page.locator('[data-qty-up]')).toBeDisabled();
  } else {
    await expect(page.locator('[data-qty-up]')).toBeEnabled();
  }
});

test('remove from cart empties it and clears the nav badge', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  await page.click('[data-remove]');
  await expect(page.locator('.shop-empty')).toContainText('empty');
  await expect(page.locator('#nav-cart-count')).toHaveText('');
});

test('fulfillment options and order summary render for a real cart item', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  const canShip = product.shipping_class !== 'pickup_only';
  const canPickup = product.pickup_available === true;
  if (canShip && canPickup) {
    await expect(page.locator('input[name="fulfillment"]')).toHaveCount(2);
  } else if (!canShip && !canPickup) {
    await expect(page.locator('.cart-conflict')).toBeVisible();
  }
  // Either way, totals render without crashing.
  await expect(page.locator('body')).not.toContainText('undefined');
});

test('choosing Local Pickup shows $0.00 shipping and the pickup contact form (when pickup is offered)', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');
  test.skip(product.pickup_available !== true, 'current test product does not allow local pickup');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  const pickupRadio = page.locator('input[name="fulfillment"][value="pickup"]');
  if (await pickupRadio.count()) await pickupRadio.check();
  await expect(page.locator('.cart-summary-row', { hasText: 'Local Pickup' })).toContainText('$0.00');
  await expect(page.locator('[data-field="line1"]')).toHaveCount(0);
  await expect(page.locator('[data-field="fullName"]')).toBeVisible();
});

test('choosing Shipping shows the full US address form (when shipping is offered)', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');
  test.skip(product.shipping_class === 'pickup_only', 'current test product is pickup-only, no shipping to test');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  const shippingRadio = page.locator('input[name="fulfillment"][value="shipping"]');
  if (await shippingRadio.count()) await shippingRadio.check();
  await expect(page.locator('[data-field="line1"]')).toBeVisible();
  await expect(page.locator('[data-field="city"]')).toBeVisible();
  await expect(page.locator('[data-field="state"]')).toBeVisible();
  await expect(page.locator('[data-field="zip"]')).toBeVisible();
  await expect(page.getByText('United States only')).toBeVisible();
});

test('Continue to Payment stays disabled until required fields are filled, then shows the placeholder message without charging or creating an order', async ({ page }) => {
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');
  test.skip(product.pickup_available !== true, 'needs a pickup-eligible product so the always-$0 path is testable regardless of shipping-rate configuration');

  const postedToOrders = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && /\/rest\/v1\/(orders|order_items)/.test(req.url())) postedToOrders.push(req.url());
  });

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  const pickupRadio = page.locator('input[name="fulfillment"][value="pickup"]');
  if (await pickupRadio.count()) await pickupRadio.check();

  const continueBtn = page.locator('#continue-to-payment-btn');
  await expect(continueBtn).toBeDisabled();
  await page.fill('[data-field="fullName"]', 'Test Customer');
  await page.fill('[data-field="email"]', 'test@example.com');
  await expect(continueBtn).toBeEnabled();

  await continueBtn.click();
  await expect(page.locator('#payment-placeholder-msg')).toBeVisible();
  await expect(page.locator('#payment-placeholder-msg')).toContainText('not enabled yet');
  await expect(continueBtn).toBeDisabled();

  expect(postedToOrders, 'a write to orders/order_items happened — Stage 6 must never create a real order').toEqual([]);
});

test('mobile: cart page has no horizontal scroll and controls are usable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  const product = await getLiveTestProduct();
  test.skip(!product, 'no available/in-stock product exists right now to test against');

  await addProductToCart(page, product.slug);
  await page.goto('/cart', { waitUntil: 'networkidle' });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth, 'page is wider than the viewport — horizontal scroll').toBeLessThanOrEqual(clientWidth + 1);

  await expect(page.locator('.cart-qty-controls')).toBeVisible();
});
