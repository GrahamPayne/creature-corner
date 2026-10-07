-- Creature Corner shop — Supabase schema
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- against a fresh project. Safe to re-run: every statement is guarded with
-- IF NOT EXISTS / OR REPLACE where Postgres allows it.
--
-- Money is always integer cents (e.g. $42.00 = 4200). Never store floats for money.

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- ADMINS
-- One row per admin user. Referenced by RLS policies below via is_admin().
-- No RLS policy grants anon/authenticated access to this table at all —
-- it is only ever read through the SECURITY DEFINER function is_admin(),
-- so a client can't enumerate or tamper with who's an admin.
-- ============================================================
create table if not exists admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table admins enable row level security;
-- Intentionally no policies: nobody using the anon/authenticated client can
-- read or write this table. Add the first admin via the SQL editor (see
-- docs/SHOP_SETUP.md) using the service role, which bypasses RLS.

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ============================================================
-- updated_at helper trigger
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ============================================================
-- SHIPPING CLASSES
-- Flat-rate shipping lookup. flat_price_cents is nullable — null means
-- "not priced yet" (checkout treats it as $0 / to-be-arranged for now).
-- Keeping this as its own table means adding real shipping prices later
-- is an UPDATE, not a schema or code change.
-- ============================================================
create table if not exists shipping_classes (
    key text primary key,
    label text not null,
    flat_price_cents integer check (flat_price_cents is null or flat_price_cents >= 0)
);

insert into shipping_classes (key, label, flat_price_cents) values
    ('small', 'Small', null),
    ('medium', 'Medium', null),
    ('large', 'Large', null),
    ('oversized', 'Oversized', null),
    ('pickup_only', 'Local pickup only', 0)
on conflict (key) do nothing;

alter table shipping_classes enable row level security;

create policy "shipping classes are publicly readable"
    on shipping_classes for select
    to anon, authenticated
    using (true);

create policy "only admins manage shipping classes"
    on shipping_classes for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- CATEGORIES
-- ============================================================
create table if not exists categories (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null,
    sort_order integer not null default 0
);

insert into categories (slug, name, sort_order) values
    ('original-art', 'Original Art', 0),
    ('plants', 'Plants', 1),
    ('masks', 'Masks', 2),
    ('prints', 'Prints', 3),
    ('small-stuff', 'Small Stuff', 4)
on conflict (slug) do nothing;

alter table categories enable row level security;

create policy "categories are publicly readable"
    on categories for select
    to anon, authenticated
    using (true);

create policy "only admins manage categories"
    on categories for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- PRODUCTS
-- status: draft | available | sold | hidden
--   draft   — not finished, never shown publicly
--   available — shown publicly, purchasable if quantity > 0
--   sold    — shown publicly (so the piece stays viewable), not purchasable
--   hidden  — unpublished, not shown publicly (manual "take this down")
-- ============================================================
create table if not exists products (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    price_cents integer not null check (price_cents >= 0),
    short_description text,
    description text,
    category_id uuid references categories(id) on delete set null,
    dimensions text,
    materials text,
    quantity integer not null default 1 check (quantity >= 0),
    shipping_class text not null default 'medium' references shipping_classes(key),
    pickup_available boolean not null default false,
    featured boolean not null default false,
    status text not null default 'draft' check (status in ('draft', 'available', 'sold', 'hidden')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists products_category_id_idx on products(category_id);
create index if not exists products_status_idx on products(status);

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
    before update on products
    for each row
    execute function set_updated_at();

alter table products enable row level security;

-- Public can only ever see products that are "live" in some form.
-- Draft and hidden products never reach anon/authenticated clients.
create policy "published products are publicly readable"
    on products for select
    to anon, authenticated
    using (status in ('available', 'sold'));

create policy "only admins manage products"
    on products for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- PRODUCT IMAGES
-- storage_path is the path inside the `product-images` Storage bucket.
-- ============================================================
create table if not exists product_images (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references products(id) on delete cascade,
    storage_path text not null,
    sort_order integer not null default 0,
    is_primary boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists product_images_product_id_idx on product_images(product_id, sort_order);

alter table product_images enable row level security;

-- Images are readable only when their parent product is publicly visible —
-- mirrors the products policy so a draft/hidden product's photos can't leak.
create policy "images of published products are publicly readable"
    on product_images for select
    to anon, authenticated
    using (
        exists (
            select 1 from products
            where products.id = product_images.product_id
              and products.status in ('available', 'sold')
        )
    );

create policy "only admins manage product images"
    on product_images for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- ORDERS / ORDER_ITEMS
-- Written ONLY by the server-side Cloudflare Function using the Supabase
-- service role key, which bypasses RLS entirely — so no anon/authenticated
-- INSERT/UPDATE policy exists here on purpose. Admins get read access so a
-- future "view orders" admin screen needs no new server endpoint.
--
-- status: pending | paid | fulfilled | cancelled | refunded
-- fulfillment_type: shipping | pickup
-- ============================================================
create table if not exists orders (
    id uuid primary key default gen_random_uuid(),
    stripe_session_id text unique,
    stripe_payment_intent_id text,
    email text,
    status text not null default 'pending' check (status in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
    fulfillment_type text not null default 'shipping' check (fulfillment_type in ('shipping', 'pickup')),
    shipping_address jsonb,
    subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
    shipping_cents integer not null default 0 check (shipping_cents >= 0),
    total_cents integer not null default 0 check (total_cents >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
    before update on orders
    for each row
    execute function set_updated_at();

alter table orders enable row level security;

create policy "only admins read orders"
    on orders for select
    to authenticated
    using (is_admin());
-- No insert/update/delete policy for anon/authenticated: orders are only
-- ever written by the service role from the checkout/webhook functions.

create table if not exists order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id) on delete cascade,
    product_id uuid references products(id) on delete set null,
    product_name text not null,
    unit_price_cents integer not null check (unit_price_cents >= 0),
    quantity integer not null check (quantity > 0),
    created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items(order_id);

alter table order_items enable row level security;

create policy "only admins read order items"
    on order_items for select
    to authenticated
    using (is_admin());

-- ============================================================
-- TABLE-LEVEL GRANTS
--
-- Row Level Security policies above are the real access control, but
-- they're the SECOND check: Postgres first checks base table privileges,
-- and tables created via the SQL editor do not automatically get the
-- anon/authenticated grants that Supabase's dashboard table creator adds
-- for you. Without these, PostgREST rejects requests before RLS even
-- runs. Granting broad table privileges here is safe — RLS still decides
-- which actual rows are visible/writable.
-- ============================================================
grant select on categories, products, product_images, shipping_classes to anon, authenticated;
grant insert, update, delete on categories, products, product_images, shipping_classes to authenticated;
grant select on orders, order_items to authenticated;
grant execute on function is_admin() to anon, authenticated;
