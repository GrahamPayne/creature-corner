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

## 3. Create the Storage bucket

1. In the dashboard, open **Storage** → **New bucket**.
2. Name it exactly `product-images`. Leave **Public bucket** toggled
   **off** — public read access is granted through a policy instead (next
   step), which keeps all access rules in one consistent place.
3. Open **SQL Editor** again, paste the contents of
   `supabase/storage-policies.sql`, and run it. This lets anyone view
   product photos but only admins upload/replace/delete them.

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

## Using the admin panel

Once connected, go to `/admin` and log in with the email/password you
created in step 4. From there you can add, edit, duplicate, and delete
products, and change their status/price/quantity/featured flag — no code
edits needed. The admin panel is intentionally plain (not styled to match
the public site) since it's a working tool, not a page visitors see.

If `/admin` still shows "Supabase isn't connected yet", steps 1–6 above
haven't been completed/sent to me yet.

## Known local-dev quirk: product URLs

In production, `/product/some-slug` is rewritten by `_redirects` to
`/product.html?slug=some-slug` — that's a Cloudflare Pages feature, so the
pretty URL only works once deployed. Locally, `npx serve` has its own
unrelated quirk: it 301-redirects any `/product.html?...` request to
`/product` and drops the query string. So when testing the product page
locally, use the extensionless form directly:
`http://localhost:3000/product?slug=some-slug`.
