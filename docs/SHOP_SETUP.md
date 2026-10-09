# Shop Setup Guide

This doc grows alongside the shop feature (see `CLAUDE.md` for the staged
build plan). Right now it covers getting Supabase ready — the Stripe,
local-dev, and deploy sections get added as those stages land.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick any name (e.g. `creature-corner`) and a strong database password —
   save that password somewhere, you won't need it day-to-day but you'll
   want it if you ever connect a DB client directly.
3. Pick a region close to you. Wait for provisioning (~2 minutes).

## 2. Run the database schema

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/schema.sql` from this repo and
   run it. It creates the `categories`, `products`, `product_images`,
   `shipping_classes`, `orders`, `order_items`, and `admins` tables, plus
   the Row Level Security policies that keep the public site read-only.
3. It's safe to re-run — repeated runs skip anything already created.
4. Run each file in `supabase/migrations/`, in order, the same way (SQL
   Editor → New query → paste → run). Each one is also safe to re-run.

## 3. Create the Storage bucket

1. In the dashboard, open **Storage** → **New bucket**.
2. Name it exactly `product-images` and toggle **Public bucket** **ON**.
   These are storefront product photos meant for anyone to see — and
   practically, Supabase's public image URLs (what every product photo on
   the site uses) only work without authentication when the bucket itself
   is Public; an RLS read policy alone isn't enough for that specific URL
   path.
3. Open **SQL Editor** again, paste the contents of
   `supabase/storage-policies.sql`, and run it. The bucket being Public
   handles anonymous reads; these policies are what actually keep
   uploading/replacing/deleting admin-only, regardless of the bucket's
   public/private setting.

## 4. Create your first admin account

Admin login uses regular Supabase Auth (email + password) — the `admins`
table just marks which logged-in users are allowed to manage products.

1. Dashboard → **Authentication** → **Users** → **Add user** → **Create
   new user**. Use your real email and a password you'll remember (this is
   your admin login for `/admin`, not a Creature Corner customer account).
2. Dashboard → **SQL Editor**, run:
   ```sql
   insert into admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   (swap in the email you just created).
3. That's it — no separate roles system, no password reset flow to build.
   To add a second admin later, repeat both steps with their email.

## 5. Collect your Supabase keys

Dashboard → **Project Settings** → **API**. You'll need:

- **Project URL** → `SUPABASE_URL`
- **anon / public key** → `SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` — ⚠️ this one bypasses
  Row Level Security entirely. It's only ever used inside Cloudflare Pages
  Functions (server-side), never in any file served to the browser.

See `.env.example` at the repo root for where each of these goes
(Cloudflare Pages dashboard vs. a local `.env` vs. committed frontend
config). Stripe-related variables will be added to that file in a later
stage, once Checkout is wired up.

## 6. Connect the site to your project

Once you've done steps 1–5, send me the **Project URL** and **anon key**
from step 5 (never the service_role key over chat — that one's server-only
and goes straight into the Cloudflare Pages dashboard when we get to
Stripe). I'll put them in `src/features/shop/api/config.js`, which flips
the shop and admin panel over from the bundled prototype data to your real
Supabase project. Nothing else changes — same pages, same design.

## Product images

From a product's Edit screen (or while adding a new one) you can upload
multiple photos, mark one Primary, reorder them, and delete them — no code
or Supabase dashboard work needed.

- **Accepted files:** JPG, PNG, WebP, up to 10MB each.
- **Optimization:** every upload is resized/re-encoded in your browser
  before it's sent — never upscaled, only downscaled if the long edge is
  over 2200px, then saved as high-quality WebP (falls back to JPEG on the
  rare browser without WebP encoding support). This keeps photos looking
  sharp while avoiding multi-megabyte originals piling up in Storage.
- **Storage path:** `products/<product-id>/<random-id>.webp` — never your
  original filename, so there's no collision risk and nothing about your
  computer leaks into the path.
- **Primary image:** controls the photo shown on `/shop` cards and as the
  main image on the product page. If nothing is marked Primary, the first
  image (by order) is used automatically. No images yet → the existing "No
  Image" placeholder.
- **Deleting a product** also deletes its Storage files, not just the
  database rows — nothing gets orphaned in Storage.

## Cart, shipping, and checkout review (Stage 6)

No payments yet — this stage makes the whole flow work mechanically:
Product → Add to Cart → Cart → Shipping/Pickup → Order Summary →
"Continue to Payment" (currently just shows a placeholder message).

- **Cart persistence:** `localStorage` holds only `{productId, quantity}`
  pairs, never price/name/image/status. `/cart` re-fetches current data
  for those ids from Supabase on every load, so a stale or hand-edited
  localStorage value can never show a wrong price or let someone
  "buy" something that's sold out since — it can only point at a product
  id, which always gets re-validated.
- **Shipping rate:** set per shipping class at **Admin → Shipping
  Settings**. Rates start unset (`null`) — the cart shows "Not yet
  configured" and blocks checkout for the Shipping path (Local Pickup is
  always free) until you set them there. No code or AI needed.
- **Shipping calculation rule:** flat rate, based on the **largest**
  shipping class present in the cart (small + medium → medium rate,
  medium + large → large rate, etc.) — not every item's rate added
  together. A product with shipping_class `pickup_only` can never be
  shipped; if your cart mixes a pickup-only item with an item that isn't
  pickup-eligible, checkout shows a clear conflict message instead of a
  wrong total.

### Stage 7 must never trust the browser

This is the most important thing to carry into the next stage. Everything
in the cart and checkout-review UI — subtotal, shipping amount, item
prices, "is this still in stock" — is for display only. When Stage 7 adds
Stripe, the server-side function that creates the Checkout Session must
re-fetch every product fresh from Supabase, re-check its status and
available quantity, recompute the shipping class and rate itself, and
compute the final total server-side. It must never accept a price,
subtotal, or shipping amount sent from the browser as fact. See the
comment on the "Continue to Payment" handler in
`src/features/shop/pages/cart.js` for the same note in code.

## Using the admin panel

Once connected, go to `/admin` and log in with the email/password you
created in step 4. From there you can add, edit, duplicate, and delete
products, and change their status/price/quantity/featured flag — no code
edits needed. The admin panel is intentionally plain (not styled to match
the public site) since it's a working tool, not a page visitors see.

If `/admin` still shows "Supabase isn't connected yet", steps 1–6 above
haven't been completed/sent to me yet.

### Admin navigation (Stage 6.5)

`/admin` now has its own nav (Products / Categories / Shipping / Orders) —
private to the logged-in admin panel, never added to the public site nav.

- **Products** — unchanged from before.
- **Categories** — add, rename, edit slug, reorder (↑/↓), and delete
  categories. Deleting a category that's still used by any product is
  blocked with a message telling you how many products use it; remove or
  recategorize them first. Reorder here also controls the category filter
  button order on the public `/shop` page.
- **Shipping** — unchanged flat-rate settings from Stage 6. This is the
  fallback shipping system; it keeps working as-is until EasyPost is
  connected (see `docs/SHIPPING_ARCHITECTURE.md`).
- **Orders** — shows "No orders yet." until Stage 7 adds real checkout.
  Filters (Needs Fulfillment / Shipping / Local Pickup / Fulfilled /
  Cancelled / Refunded) are ready for when real orders exist.

Add/Edit Product also has two new sections: **Fulfillment** (a single
mode select — Shipping + Local Pickup / Shipping Only / Local Pickup Only
/ Special Shipping - Manual Quote — replacing the old separate shipping
class + pickup checkbox) and **Packed Shipping Info** (final packed box
weight/dimensions, not the artwork's own dimensions — this is what a
future EasyPost rate lookup will use).

## Known local-dev quirk: product URLs

In production, `/product/some-slug` is rewritten by `_redirects` to
`/product.html?slug=some-slug` — that's a Cloudflare Pages feature, so the
pretty URL only works once deployed. Locally, `npx serve` has its own
unrelated quirk: it 301-redirects any `/product.html?...` request to
`/product` and drops the query string. So when testing the product page
locally, use the extensionless form directly:
`http://localhost:3000/product?slug=some-slug`.
