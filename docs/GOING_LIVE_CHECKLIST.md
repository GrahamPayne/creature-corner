# Going Live with Stripe — Creature Corner

Checklist for switching checkout from **Stripe Sandbox** to **live payments**.

> ⚠️ **Do not enable live payments until every box in "Pre-flight" is ticked.**
> The code ships with a deliberate guard (`assertSandboxMode` in
> `src/features/shop/payments/providers/stripeProvider.js`) that **refuses any
> non-`sk_test_` key unless `STRIPE_MODE=live` is explicitly set** — so a live
> key alone does nothing until you consciously flip the mode.

---

## Current status (verified in Sandbox — 2026-11-16)

The full server-side pipeline is confirmed working end-to-end in Sandbox:

- Checkout creates an order, reserves inventory, and mints a Stripe Checkout
  Session (`functions/api/orders/create.js`).
- A completed test payment fired `checkout.session.completed`; the webhook
  (`functions/api/webhooks/stripe.js` → `process_stripe_event`) verified the
  signature, matched amount + currency, marked the order **paid**, and
  decremented inventory **exactly once** (idempotent via the
  `payment_events (provider, provider_event_id)` unique constraint).
- Order visible in Admin → Orders; inventory went 3 → 2.

Root-cause fix that unblocked this: `supabase/migrations/007_service_role_grants.sql`
(the server Functions query as `service_role`, which had no table GRANTs).

---

## Pre-flight (do all of these first)

- [ ] **Decide sales tax.** `create.js` currently hard-codes `taxCents: 0`
      (`STRIPE_AUTOMATIC_TAX` off). Confirm whether you must collect sales tax
      for your state(s). If yes: complete a Stripe Tax registration, then set
      `STRIPE_AUTOMATIC_TAX=true` and remove the hard-coded zero. **Do not sell
      live with tax silently at $0 if you are obligated to collect it.**
- [ ] **Review shipping rates.** Flat rates live in the `shipping_classes`
      table (`flat_price_cents`). The TEST product used `medium` = $40. Verify
      every class's rate is correct for real orders before selling.
- [ ] **Audit real products.** For each product confirm `status`,
      `shipping_class`, and `pickup_available` are correct (these drive
      server-side pricing and the pickup/ship fulfillment rules).
- [ ] **Confirm the business entity / Stripe account** is fully activated for
      live charges (Stripe dashboard → Activate account: bank details, tax ID,
      identity).
- [ ] **Remove test data.** Cancel/clear the Sandbox test orders
      (e.g. `CC-20261117-0001` / `-0002`) and reset the TEST product's
      inventory, or hide the TEST product (`status` ≠ `available`).

## The switch (Cloudflare Pages → Settings → Environment variables, Production)

- [ ] Set `STRIPE_SECRET_KEY` to the **live** secret key (`sk_live_…`).
- [ ] Set `STRIPE_MODE=live` (required — without it the guard rejects the live key).
- [ ] Set `STRIPE_WEBHOOK_SECRET` to the **live** endpoint's signing secret
      (see next section — it is a *different* secret from the Sandbox one).
- [ ] Redeploy (Cloudflare snapshots env vars per deployment — a redeploy is
      required for new values to take effect).

## Stripe dashboard (live mode)

- [ ] Toggle the dashboard to **live** mode (not "Test mode").
- [ ] Create a webhook endpoint → `https://creaturecorner.art/api/webhooks/stripe`.
- [ ] Subscribe to at least: `checkout.session.completed`,
      `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
      `checkout.session.async_payment_failed`, `charge.refunded`
      (every event `process_stripe_event` already handles).
- [ ] Copy the **live** signing secret into `STRIPE_WEBHOOK_SECRET` (above).

> The webhook self-protects against mode mix-ups: `process_stripe_event` binds
> `event.livemode` to whether the order's Checkout reference is `cs_live_…` vs
> `cs_test_…`, and `webhooks/stripe.js` rejects an event whose `livemode`
> doesn't match `STRIPE_MODE`. A test event can't post against live data, or
> vice-versa.

## Verify after switching (one real low-value purchase)

- [ ] Buy one cheap real item (real card). Confirm redirect to Stripe **live**
      checkout (`cs_live_…`), successful payment, and redirect to
      `/order-confirmation`.
- [ ] Confirm the webhook delivered (Stripe dashboard → the endpoint → recent
      deliveries show `200`), the order is **paid** in Admin, and inventory
      decremented exactly once.
- [ ] (Optional, recommended) In Stripe dashboard, **resend** the
      `checkout.session.completed` event and confirm it returns
      `already processed` with **no** second inventory decrement.
- [ ] Refund that test purchase from the Stripe dashboard and confirm the order
      flips to `refunded` in Admin (exercises the `charge.refunded` path).

## Rollback (if anything looks wrong)

- [ ] Set `STRIPE_MODE` back to unset/`sandbox` and `STRIPE_SECRET_KEY` back to
      the `sk_test_…` key, then redeploy. The guard immediately returns
      checkout to Sandbox-only; no code change needed.

---

## Operational notes / known gaps

- **Expired-reservation sweep is lazy.** `reserve_inventory` expires stale
  holds per-product on demand; the scheduled bulk sweep
  (`release_expired_reservations`) is **not** yet wired to a Cloudflare Cron
  Trigger. Correctness holds without it, but consider adding the cron before
  high volume.
- **Functions logs.** Use `npx wrangler pages deployment tail <deployment-id>
  --project-name creature-corner` for live server-side logs (the dashboard
  "Observability" live tail does not work for this project).
- **Secrets never appear in code or responses.** Keep it that way — all Stripe
  and Supabase secrets are Cloudflare Pages env vars only.
