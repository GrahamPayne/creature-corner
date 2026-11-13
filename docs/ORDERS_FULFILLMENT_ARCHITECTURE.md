# Orders & fulfillment infrastructure

This builds out `docs/ORDERS_AND_PACKING_SLIP.md`'s Stage 6.5 placeholder
into a real order-management system: persistent orders with separate
payment/fulfillment/shipping status, atomic inventory reservations, a
provider-agnostic payment/shipping-label interface, and an admin-only Safe
Test Mode. **No live payment or shipping-label provider is connected** —
that's intentionally the next phase, once credentials exist.

## What already existed (Stage 6/6.5)

- `orders`/`order_items` tables, written only by a service-role Cloudflare
  Function that was never built — `/shop`'s "Continue to Payment" button
  has always been a placeholder (see `pages/cart.js`); clicking it shows a
  message and makes no network write. This is unchanged.
- A single `orders.status` enum (`pending|paid|fulfilled|cancelled|refunded`)
  conflating payment and fulfillment into one value.
- `admin/ordersTable.js` / `admin/orderDetail.js`: a read-only list/detail
  view with five permanently-disabled "future action" buttons.
- `shipping/shippingProvider.js`: a working provider abstraction for
  **rate quoting** only (flat-rate today, EasyPost later per
  `docs/SHIPPING_ARCHITECTURE.md`) — unrelated to label purchasing, and
  untouched by this work.

## What this adds

### Schema (`supabase/migrations/005_orders_fulfillment.sql`)

Purely additive — no existing column, row, or constraint is changed or
dropped. New `orders` columns: `order_number`, `currency`,
`billing_address`, `tax_cents`, `discount_cents`, `payment_provider`,
`payment_reference` (provider-agnostic — NOT the existing Stripe-specific
`stripe_session_id`/`stripe_payment_intent_id` columns, which stay for
backward compatibility but are no longer what new code reads/writes),
`payment_status`, `fulfillment_status`, `shipping_status` (three separate
tracks — see Order Lifecycle below), `shipping_carrier`,
`shipping_service`, `tracking_number`, `label_reference`, `notes`,
`idempotency_key`, `test_mode`, and `paid_at`/`fulfilled_at`/
`cancelled_at`/`refunded_at` timestamps. The legacy `status` column is
kept in sync by admin actions for any old reader, but no current UI code
reads it anymore.

New `order_items` columns: `product_slug`, `product_image_url` — complete
the purchase-time snapshot (`product_name`/`unit_price_cents` already
existed) so a historical order renders correctly even after the product
is edited, re-categorized, or deleted.

New tables: `inventory_reservations` (the overselling guard),
`order_events` (append-only audit trail), `payment_events` (idempotent
webhook ledger, `unique(provider, provider_event_id)`). `payment_events`
is schema-only right now — nothing writes to it yet, including the
admin-side test-payment-confirm flow, since Safe Test Mode has no real
webhook to deduplicate. It starts actually enforcing idempotency the
moment a real provider's webhook handler is built (see the handoff
checklists below) and inserts into it before processing each event.

New RPC functions: `reserve_inventory`, `confirm_reservation`,
`release_reservation`, `release_expired_reservations` — see Inventory
Reservations below.

**RLS change**: `orders`/`order_items` went from admin-SELECT-only to
admin-manage (`for all using (is_admin())`) — the same pattern
`products`/`categories`/`gallery_*` already use. This is what lets the
Admin Orders dashboard actually create test orders and update
fulfillment/tracking directly from the browser, with no server-side
function needed for any of that. A future real checkout/webhook function
still uses the service-role key (bypasses RLS entirely), so this change
doesn't affect how real orders will eventually get created.

**You must run this migration** in the Supabase SQL editor before any of
the new Admin → Orders features will work — same manual process as every
prior migration (`supabase/migrations/002`-`004`). See `docs/SHOP_SETUP.md`.

### Inventory reservations (section D)

`reserve_inventory(product_id, quantity, order_id, ttl_minutes)` is the
actual overselling guard: `select ... for update` on the product row
serializes concurrent reservation attempts for the *same* product, so two
simultaneous checkouts for the last unit of a quantity-1 piece cannot both
succeed. Reserving **never** touches `products.quantity` — only
`confirm_reservation()` (called after verified payment) does, so opening
checkout never permanently reduces stock. `release_reservation()` frees a
cancelled/expired reservation without touching inventory. All three are
idempotent (safe to call twice on an already-confirmed/released
reservation — a no-op, not an error), which is what makes duplicate
payment-confirmation events (webhook retries) safe.

Pure JS mirrors of the same arithmetic live in
`src/features/shop/order/inventoryReservation.js`, for instant client-side
feedback and for unit testing the logic without a live database — the
Postgres function is still the actual enforcement.

A scheduled sweep (`release_expired_reservations()`, callable via RPC) is
meant to run on a Cloudflare Cron Trigger — **not configured yet**
(outside what this environment has dashboard access to set up).
Correctness doesn't depend on it: `reserve_inventory()` already expires
stale reservations for a product lazily, right before computing
availability for a new request.

### Order lifecycle (section G)

Three independent tracks, each with its own valid-transition table in
`src/features/shop/order/orderStates.js`:

- **Payment**: `pending → paid|failed|cancelled`, `paid → partially_refunded|refunded`, `partially_refunded → refunded`, `failed → pending` (retry).
- **Fulfillment**: `unfulfilled → preparing|fulfilled|cancelled`, `preparing → fulfilled|unfulfilled|cancelled`, `fulfilled → unfulfilled` (correction only).
- **Shipping**: `label_not_purchased → label_created → shipped → in_transit → delivered`, with `exception` reachable from (and recoverable back to) `label_created`/`shipped`/`in_transit`.

`canMarkFulfilled(order)` enforces the one hard rule section F calls out:
an order can only be marked Fulfilled if it's paid (`paymentStatus ===
'paid'`) — or it's a test order, where "payment" is an explicit admin
confirmation, not a real charge. The admin UI disables the button
entirely when this isn't true; `admin/ordersApi.js`'s
`adminUpdateFulfillmentStatus` enforces it server-side too (RLS doesn't
know about this rule — the application does), so nothing lets a browser
bypass it.

### Payment provider architecture (section B)

`src/features/shop/payments/paymentProvider.js` defines the interface
(`createSession`, `verifyWebhookSignature`, `parseWebhookEvent`,
`getTransaction`, `refund`). Three implementations:

- `providers/testProvider.js` — the only one actually reachable today,
  and only from the admin-only test-order tool. Never touches a real
  payment network.
- `providers/stripeProvider.js`, `providers/paypalProvider.js` — every
  method throws `ProviderNotConfiguredError`. Each file's header comment
  is a step-by-step handoff checklist (mirrors
  `docs/SHIPPING_ARCHITECTURE.md`'s EasyPost checklist) for when real
  credentials arrive. Deliberately independent of each other — PayPal is
  never routed through Stripe.

`payments/providerRegistry.js` is the one place a provider is selected by
name; adding Square later is a new file plus one registry line.

### Shipping label architecture (section H)

Same pattern, new file `src/features/shop/shipping/labelProvider.js`
(separate from the existing rate-quoting `shippingProvider.js`, which is
untouched): `validateAddress`, `getRates`, `purchaseLabel`, `getLabel`,
`getTracking`, `refundLabel`. `manualLabelProvider.js` is the only
implementation usable today — `getRates`/`purchaseLabel` throw on purpose
(no fake rates, no fake label purchase button); what it does support is
real: the Order Detail page's "Save Tracking Info" writes
carrier/service/tracking number directly onto the order, no provider call
at all. `providers/easypostLabelProvider.js` and
`providers/shippoLabelProvider.js` are documented, unconnected stubs.

### Admin notifications (section I)

`notifications/notificationProvider.js` defines `notify({type, order,
recipient})`. The only configured implementation,
`noopNotificationProvider.js`, logs what it would have sent and always
returns `sent: false` — not a placeholder claiming success, the literal
truth. `admin/ordersApi.js` calls it (best-effort, never blocking the
order action it's attached to) on payment confirmation, fulfillment,
tracking added, cancellation, and refund — the exact five events section I
lists — so wiring up a real provider later is swapping one file, not
finding every call site.

### Safe Test Mode (section J)

`admin/testOrderForm.js` + `admin/ordersApi.js`'s `adminCreateTestOrder`/
`adminConfirmTestPayment`/`adminRefundOrder`: creates a real, persistent
order (exercising the actual reservation/order-creation code a real
checkout will use) with `payment_provider: 'test'`, `test_mode: true`,
and `payment_status: 'pending'` — never auto-paid. The admin table badges
every test order `TEST` in a highlighted pill; the detail page repeats it
prominently. `adminConfirmTestPayment`/`adminRefundOrder` both refuse
outright (`ProviderNotConfiguredError`) on any non-test order — there is
no code path that can mark a real order paid or refunded without a real
provider, by construction, not by convention.

Reachable only from inside the authenticated Admin → Orders screen —
there is no public entry point, nothing on `/shop` or `/cart` changed at
all.

### The future real checkout function

`functions/api/orders/create.js` is a **scaffold**, written to show the
real shape (re-fetch authoritative product data, validate, reserve
inventory via the same RPC, compute totals server-side with the same
`orderTotals.js` the admin tool uses, insert the order via the
service-role key) but genuinely untested — this environment has no
Cloudflare dashboard access to set `SUPABASE_SERVICE_ROLE_KEY` as a Pages
secret, and no way to invoke a deployed Function to verify it end-to-end.
It is **not wired to any live page** — `pages/cart.js`'s "Continue to
Payment" button is completely unchanged, still a placeholder. Treat this
file as a documented seam, the same honest status
`docs/SHIPPING_ARCHITECTURE.md` already gives the EasyPost rate-quoting
plan, not as verified working code.

## What's deliberately still inactive

- No live Stripe/PayPal/Square credentials, no real checkout.
- No live shipping-label purchasing.
- No real customer email delivery.
- `functions/api/orders/create.js` exists but isn't reachable from any page.
- A scheduled reservation-expiry sweep (Cloudflare Cron Trigger) isn't configured.

## Manual follow-up required

1. Run `supabase/migrations/005_orders_fulfillment.sql` in the Supabase
   SQL editor (Dashboard → SQL Editor) — nothing here works until this
   migration is applied.
2. When ready to connect a real payment provider: follow the handoff
   checklist at the top of `payments/providers/stripeProvider.js` or
   `paypalProvider.js`.
3. When ready to connect label purchasing: follow the same pattern in
   `shipping/providers/easypostLabelProvider.js` or `shippoLabelProvider.js`.
4. Configure a Cloudflare Cron Trigger to call `release_expired_reservations()`
   periodically once real checkout traffic exists.
