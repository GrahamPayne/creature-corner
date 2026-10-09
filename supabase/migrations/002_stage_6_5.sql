-- Creature Corner shop — Stage 6.5 migration
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query), AFTER supabase/schema.sql has already been applied. Safe to
-- re-run: every statement is additive and guarded with IF NOT EXISTS /
-- ON CONFLICT where Postgres allows it. Nothing here rewrites or deletes
-- existing data.
--
-- Purpose: packed-shipping data for a future EasyPost rate integration,
-- a "Special Shipping / Manual Quote" fulfillment option, and two
-- forward-compatible columns on `orders` for the future order detail view.
-- EasyPost itself is NOT called anywhere yet — see docs/SHIPPING_ARCHITECTURE.md.

-- ============================================================
-- PRODUCTS — packed shipping info
-- Nullable/defaulted so pickup-only products never need this data filled
-- in. Dimensions are nullable (no sensible default); weight defaults to
-- 0/0 since lb and oz are only meaningful together.
-- ============================================================
alter table products add column if not exists packed_weight_lb numeric not null default 0;
alter table products add column if not exists packed_weight_oz numeric not null default 0;
alter table products add column if not exists package_length_in numeric;
alter table products add column if not exists package_width_in numeric;
alter table products add column if not exists package_height_in numeric;

do $$ begin
    alter table products add constraint products_packed_weight_lb_check check (packed_weight_lb >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
    alter table products add constraint products_packed_weight_oz_check check (packed_weight_oz >= 0 and packed_weight_oz < 16);
exception when duplicate_object then null;
end $$;

do $$ begin
    alter table products add constraint products_package_length_in_check check (package_length_in is null or package_length_in > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
    alter table products add constraint products_package_width_in_check check (package_width_in is null or package_width_in > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
    alter table products add constraint products_package_height_in_check check (package_height_in is null or package_height_in > 0);
exception when duplicate_object then null;
end $$;

-- ============================================================
-- SHIPPING CLASSES — Special Shipping / Manual Quote
-- manual_quote=true means "never auto-price this, always null" — the
-- cart treats it as permanently unconfigured and shows a manual-quote
-- notice instead of a fake flat rate. See shippingProvider.js.
-- ============================================================
alter table shipping_classes add column if not exists manual_quote boolean not null default false;

insert into shipping_classes (key, label, flat_price_cents, manual_quote) values
    ('special_quote', 'Special Shipping / Manual Quote', null, true)
on conflict (key) do nothing;

-- products.shipping_class already references shipping_classes(key), so
-- the new row is immediately selectable with no further FK changes.

-- ============================================================
-- ORDERS — forward-compatible customer fields
-- shipping_address (jsonb) covers name for shipping orders, but pickup
-- orders have no address at all — these two columns cover both cases
-- uniformly for the future order detail CUSTOMER section.
-- ============================================================
alter table orders add column if not exists customer_name text;
alter table orders add column if not exists customer_phone text;

create index if not exists orders_status_idx on orders(status);
