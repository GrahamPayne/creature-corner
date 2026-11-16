# Orders & fulfillment infrastructure

This builds out `docs/ORDERS_AND_PACKING_SLIP.md`'s Stage 6.5 placeholder
into a real order-management system: persistent orders with separate
payment/fulfillment/shipping status, atomic inventory reservations, a
provider-agnostic payment/shipping-label interface, and an admin-only Safe
Test Mode.

**Stripe Checkout is now really connected, Sandbox (test mode) only** —
see "Real Stripe Checkout integration" below. `assertSandboxMode()` in
`stripeProvider.js` refuses any key that isn't `sk_test_...` unless
`STRIPE_MODE` is explicitly set to `"live"`, so this stays sandboxed at the
code level, not just by convention, until someone deliberately flips that.
No live shipping-label provider is connected yet — that's still a later
phase.

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
is now live, via `supabase/migrations/006_atomic_stripe_webhooks.sql`'s
`process_stripe_event(p_event jsonb)`: a single service-role-only SQL
function that `functions/api/webhooks/stripe.js` calls via RPC after
verifying the signature. The insert into `payment_events` (`on conflict
(provider, provider_event_id) do nothing`), the inventory confirmation,
and the order status update all happen inside that one function call —
one Postgres transaction — so a duplicate delivery's insert is a no-op
and a failure partway through (e.g. an inventory conflict) rolls back
everything, including the `payment_events` row, leaving the event safe
for Stripe to retry. The webhook handler itself holds no business logic
beyond signature/shape verification; see migration 006 for the actual
rules. Safe Test Mode still never writes to it — there's no real webhook
to deduplicate there.

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
`getTransaction`, `refund`), each now threading an `env` credentials bag
through so a provider never needs module-level secrets. Implementations:

- `providers/testProvider.js` — admin-only test-order tool, never touches
  a real payment network.
- `providers/stripeProvider.js` — **real**, talking to Stripe's REST API
  directly via `fetch()` (deliberately no `stripe` npm package — this
  project's Cloudflare Pages build has no configured build command, so
  `node_modules` is never installed before Functions bundling; any
  npm-resolved import fails there even though it works locally). Builds
  Checkout Sessions from inline `price_data` line items (never
  pre-created Stripe Price/Product objects, so the catalog is never
  duplicated into Stripe), verifies webhook signatures with Web Crypto
  HMAC-SHA256 (constant-time compare, 5-minute replay-tolerance window),
  and is hard-gated to Sandbox by `assertSandboxMode()`.
- `providers/paypalProvider.js` — still every method throws
  `ProviderNotConfiguredError`; its header comment is a step-by-step
  handoff checklist, deliberately independent of Stripe so PayPal is
  never routed through it.

`payments/providerRegistry.js` is the one place a provider is selected by
name; adding Square later is a new file plus one registry line.

### Real Stripe Checkout integration

Three Cloudflare Pages Functions, all talking to Supabase via the same
hand-rolled fetch-based REST/RPC client used elsewhere in `functions/`
(no SDK, for the same no-npm-install reason as above):

- **`functions/api/orders/create.js`** — wired to `pages/cart.js`'s
  "Continue to Payment" button. Re-fetches every product server-side
  (price, quantity, status, shipping class — the browser's cart is never
  trusted for any of it), re-checks the fulfillment choice against
  `determineFulfillmentOptions`, computes a real shipping quote via
  `getShippingQuote` (never assumes free shipping, 409s if shipping isn't
  configured for the cart), computes totals with `tax_cents: 0` explicit
  (not omitted — see Sales tax below), creates the order + order_items +
  one `reserve_inventory` call per item (30-minute TTL), then calls
  `stripeProvider.createSession()` and stores the returned session id as
  `orders.payment_reference`. If Stripe itself fails after the order/
  reservation exist, both are left intact (status stays `pending`) for
  admin cleanup — nothing is charged, nothing is silently lost.
- **`functions/api/webhooks/stripe.js`** — the only path that can ever
  mark a real order Paid (never the browser redirect, never an admin
  action — `adminConfirmTestPayment`/`adminRefundOrder` explicitly refuse
  any non-test order). Reads the raw request body and verifies its
  signature *before* any JSON parsing; records every verified event in
  `payment_events` first (the idempotency gate) and only then processes
  it, so a processing bug can never silently lose a paid order — the raw
  event is still on file to reprocess. `confirmOrderReservations()`
  re-attempts `reserve_inventory` for any reservation that already
  expired or was released before a late/out-of-order
  `checkout.session.completed` arrives (recovering the common case where
  stock is still available); if that genuinely can't recover (the stock
  sold to someone else in the interim), the order is still marked `paid`
  truthfully but a `payment.inventory_conflict` `order_events` row is
  written so it surfaces in Admin → Orders for manual reconciliation —
  never silently dropped. `charge.refunded` deliberately never touches
  inventory/reservations — restoring a one-of-a-kind piece after a refund
  stays an explicit admin decision via the product editor.
- **`functions/api/orders/status.js`** — the only thing
  `order-confirmation.html` ever reads. Looks orders up by the Stripe
  Checkout Session id (an unguessable capability token — the same trust
  level Stripe's own redirect already implies) and returns only
  non-sensitive fields. The confirmation page polls this a handful of
  times and only clears the local cart once it sees `paymentStatus ===
  'paid'` from the server — the redirect itself is never treated as proof
  of payment.

Required Cloudflare Pages secrets: `SUPABASE_SERVICE_ROLE_KEY` (already
in use by other Functions), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
Optional: `STRIPE_MODE` (must be exactly `"live"` to allow a non-`sk_test_`
key), `STRIPE_AUTOMATIC_TAX` (`"true"` to enable Stripe Tax — see below).

#### Sales tax

The Stripe account is on "Tax Basic" and CA seller's-permit registration
isn't complete, so `automatic_tax.enabled` defaults to `false`
(`STRIPE_AUTOMATIC_TAX` unset or anything other than `"true"`) and
`tax_cents` is computed as an explicit `0`, never omitted. Flipping
`STRIPE_AUTOMATIC_TAX` to `"true"` is the only step needed once
registration is actually complete — do not do this before then.

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

### History: the Cloudflare Functions build issues (resolved)

Earlier attempts to add `/functions` broke the Cloudflare Pages build
entirely — not just the one route, but every static asset in the same
deploy stopped updating. Root causes, found and fixed one at a time by
diffing a local Wrangler build against what Cloudflare's build log
reported:

1. The very first `/functions` directory addition broke the whole build;
   it was pulled from that deploy to unblock everything else while the
   cause was tracked down.
2. `wrangler.toml` was missing the required top-level `name` field.
3. `@supabase/supabase-js` (and, by the same logic, the `stripe` npm
   package) can never be resolved, because this project's Cloudflare
   Pages build has **no configured build command**, so `npm install`
   never runs before the Functions bundler does — an import that
   resolves fine locally (where `node_modules` already exists from a
   manual `npm install`) fails on Cloudflare with "Could not resolve".
   This is why every Function in this project (Supabase client *and*
   Stripe client) is a hand-written `fetch()`-based wrapper instead of an
   SDK. Verified by running `npx wrangler pages functions build functions
   --outdir=...` locally with `node_modules` renamed out of the way
   first, to reproduce Cloudflare's real build environment exactly — this
   is the standard pre-deploy check for any change under `functions/`.

## What's deliberately still inactive

- Stripe is Sandbox/test-mode only — `assertSandboxMode()` refuses a
  non-`sk_test_` key unless `STRIPE_MODE=live` is explicitly set.
- No PayPal/Square credentials, no real checkout through either.
- Stripe Tax is wired but defaults off (`STRIPE_AUTOMATIC_TAX` unset) —
  CA seller's-permit registration isn't complete yet.
- No live shipping-label purchasing.
- No real customer email delivery.
- A scheduled reservation-expiry sweep (Cloudflare Cron Trigger) isn't
  configured — correctness doesn't depend on it (see Inventory
  reservations above), it's a cleanup-pass nice-to-have.

## Manual follow-up required

1. Run `supabase/migrations/005_orders_fulfillment.sql`, then
   `supabase/migrations/006_atomic_stripe_webhooks.sql`, in the Supabase
   SQL editor (Dashboard → SQL Editor), in that order — nothing here
   works until both are applied. 006 replaces 005's `reserve_inventory`/
   `confirm_reservation` with lock-order-corrected versions and adds
   `process_stripe_event()`; it is safe to run even if 005 already ran.
2. Configure Stripe Sandbox secrets in Cloudflare Pages → this project →
   Settings → Environment variables (Production), as encrypted secrets,
   never committed to the repo: `STRIPE_SECRET_KEY` (Stripe Dashboard →
   Developers → API keys → Secret key, Sandbox/test mode — starts
   `sk_test_...`) and `STRIPE_WEBHOOK_SECRET` (created in the next step).
3. In the Stripe Dashboard (Sandbox/test mode), create a webhook
   destination pointing at `https://creaturecorner.art/api/webhooks/stripe`,
   subscribed to: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
   `checkout.session.async_payment_failed`, `payment_intent.payment_failed`,
   `charge.refunded`. Copy its signing secret into Cloudflare as
   `STRIPE_WEBHOOK_SECRET`, then send a test event from the Stripe
   Dashboard and confirm it returns `200`.
4. When ready to connect PayPal: follow the handoff checklist at the top
   of `payments/providers/paypalProvider.js`.
5. When ready to connect label purchasing: follow the same pattern in
   `shipping/providers/easypostLabelProvider.js` or `shippoLabelProvider.js`.
6. Configure a Cloudflare Cron Trigger to call `release_expired_reservations()`
   periodically once real checkout traffic exists.
7. Before enabling live payments: complete CA seller's-permit
   registration, then set `STRIPE_AUTOMATIC_TAX=true`; separately swap in
   a live Stripe key and set `STRIPE_MODE=live` only when actually ready
   to accept real charges.
