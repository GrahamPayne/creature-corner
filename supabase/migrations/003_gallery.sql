-- Creature Corner — Gallery Management migration
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query), AFTER supabase/schema.sql and supabase/migrations/002_stage_6_5.sql
-- have already been applied. Safe to re-run: every statement is additive
-- and guarded with IF NOT EXISTS / ON CONFLICT where Postgres allows it.
-- Nothing here touches products, categories, orders, or the existing
-- product-images bucket.
--
-- Purpose: moves the public /gallery page from hardcoded HTML to an
-- admin-manageable Supabase table + Storage bucket, fully independent of
-- the shop/products system (see docs — gallery items may optionally link
-- to a product, but never require one).

-- ============================================================
-- GALLERY ITEMS
-- ============================================================
create table if not exists gallery_items (
    id uuid primary key default gen_random_uuid(),
    storage_path text not null,
    title text,
    caption text,
    alt_text text,
    sort_order integer not null default 0,
    visible boolean not null default true,
    featured boolean not null default false,
    product_id uuid references products(id) on delete set null,
    link_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists gallery_items_sort_order_idx on gallery_items(sort_order);

drop trigger if exists gallery_items_set_updated_at on gallery_items;
create trigger gallery_items_set_updated_at
    before update on gallery_items
    for each row
    execute function set_updated_at();

alter table gallery_items enable row level security;

-- Public can only ever see items the admin has marked visible — mirrors
-- the products table's "published products are publicly readable" policy.
create policy "visible gallery items are publicly readable"
    on gallery_items for select
    to anon, authenticated
    using (visible = true);

create policy "only admins manage gallery items"
    on gallery_items for all
    to authenticated
    using (is_admin())
    with check (is_admin());

grant select on gallery_items to anon, authenticated;
grant insert, update, delete on gallery_items to authenticated;

-- ============================================================
-- STORAGE — gallery-images bucket
--
-- Supabase Storage buckets live in the storage.buckets table, which the
-- SQL Editor can insert into directly — no separate dashboard step
-- needed. If this INSERT ever fails due to project-specific permissions,
-- create the bucket manually instead: Dashboard → Storage → New bucket →
-- name it exactly "gallery-images" → toggle "Public bucket" ON → then
-- re-run just the four policies below.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('gallery-images', 'gallery-images', true)
on conflict (id) do nothing;

-- Same reasoning as storage-policies.sql's product-images policies: the
-- bucket's Public flag is what makes anonymous getPublicUrl() reads work;
-- these INSERT/UPDATE/DELETE policies are what keep writes admin-only.
create policy "gallery images are publicly readable"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'gallery-images');

create policy "only admins upload gallery images"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'gallery-images' and is_admin());

create policy "only admins update gallery images"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'gallery-images' and is_admin())
    with check (bucket_id = 'gallery-images' and is_admin());

create policy "only admins delete gallery images"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'gallery-images' and is_admin());