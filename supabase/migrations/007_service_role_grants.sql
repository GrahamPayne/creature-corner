-- Creature Corner shop — grant service_role the privileges the server-side
-- checkout & webhook Pages Functions actually use.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query), after schema.sql and migrations 002-006. Safe to re-run: GRANT is
-- idempotent and this migration only ADDS privileges — it revokes nothing,
-- drops nothing, touches no rows, and changes no RLS policy.
--
-- WHY THIS IS NEEDED
-- ------------------
-- This project manages table privileges explicitly (see the "TABLE-LEVEL
-- GRANTS" block in schema.sql): tables created via the SQL editor don't get
-- Supabase's automatic per-role grants, so each one is granted by hand. Every
-- such grant so far targeted `anon` and `authenticated` only — the roles the
-- browser and the admin UI use. The server-side Pages Functions
-- (functions/api/orders/create.js, orders/status.js, webhooks/stripe.js) talk
-- to PostgREST as `service_role`, which was never included.
--
-- service_role has BYPASSRLS, but that only skips Row Level Security — it does
-- NOT skip base table privileges, which Postgres checks FIRST. So the live
-- checkout failed at its very first query with
--   42501  permission denied for table products
-- even though the stored key is a valid, unexpired service_role key for this
-- project (the "Could not load products" incident). This is the root-cause fix.
--
-- Scope: exactly what those Functions touch directly. The SECURITY DEFINER
-- functions (reserve_inventory, release_reservation, process_stripe_event, ...)
-- execute as their owner, so service_role needs only EXECUTE on them, never
-- direct privileges on the tables they modify internally.

-- Schema access (service_role already has this by default — the 42501 above
-- was table-level, proving schema USAGE is fine — but stated here so the
-- migration is self-contained and re-runnable).
grant usage on schema public to service_role;

-- Reads. create.js re-prices every order server-side from the catalog; its
-- products query embeds product_images, so SELECT on that table is required
-- for the embed. shipping_classes is read for server-computed shipping.
grant select on products, product_images, shipping_classes to service_role;

-- Orders. create.js counts (SELECT), inserts, then updates orders
-- (payment_reference); status.js reads an order plus its embedded order_items
-- for the public confirmation page; create.js inserts order_items.
grant select, insert, update on orders to service_role;
grant select, insert on order_items to service_role;

-- RPCs create.js calls directly. process_stripe_event was already granted to
-- service_role in migration 006; these two were granted to `authenticated`
-- only. Signatures must match the definitions in migration 005 exactly.
grant execute on function reserve_inventory(uuid, integer, uuid, integer) to service_role;
grant execute on function release_reservation(uuid) to service_role;
