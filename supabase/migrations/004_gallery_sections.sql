-- Creature Corner — Gallery Sections migration
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query), AFTER supabase/migrations/003_gallery.sql has already been
-- applied. Nothing here touches products, categories, orders, shipping,
-- or any existing gallery_items row/Storage file — every existing
-- gallery image is preserved exactly as-is and simply has no section
-- assigned yet (shows as "Unassigned" in Admin until you assign it).
--
-- Genuinely safe to re-run, including the policies: 002/003 wrapped
-- table/column/index changes in IF NOT EXISTS but left `create policy`
-- bare, which errors on a second run ("policy already exists") despite
-- claiming to be repeat-safe. Every policy below is wrapped in the same
-- guarded `do $$ ... exception when duplicate_object then null; end $$;`
-- pattern 002 already uses for constraints, so this file can actually be
-- run more than once without editing it first.

-- ============================================================
-- GALLERY SECTIONS
-- Public portfolio groupings (Masks / Plants / Busts / Paintings / ...),
-- entirely separate from the shop's `categories` table — a gallery
-- section is never a shop category and vice versa.
-- ============================================================
create table if not exists gallery_sections (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    sort_order integer not null default 0,
    visible boolean not null default true,
    featured_gallery_item_id uuid references gallery_items(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists gallery_sections_sort_order_idx on gallery_sections(sort_order);

drop trigger if exists gallery_sections_set_updated_at on gallery_sections;
create trigger gallery_sections_set_updated_at
    before update on gallery_sections
    for each row
    execute function set_updated_at();

alter table gallery_sections enable row level security;

do $$ begin
    create policy "visible gallery sections are publicly readable"
        on gallery_sections for select
        to anon, authenticated
        using (visible = true);
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy "only admins manage gallery sections"
        on gallery_sections for all
        to authenticated
        using (is_admin())
        with check (is_admin());
exception when duplicate_object then null;
end $$;

grant select on gallery_sections to anon, authenticated;
grant insert, update, delete on gallery_sections to authenticated;

-- ============================================================
-- GALLERY ITEMS — section assignment
-- Nullable: every existing row becomes "Unassigned" automatically, not
-- deleted or hidden. sort_order's meaning changes from here on — it's
-- now scoped PER gallery_section_id (including the null/"Unassigned"
-- group) rather than one global sequence, so Move Up/Down in Admin only
-- ever reorders siblings within the same section. No column rename
-- needed; existing sort_order values remain valid starting points.
-- ============================================================
alter table gallery_items add column if not exists gallery_section_id uuid references gallery_sections(id) on delete set null;

create index if not exists gallery_items_section_sort_idx on gallery_items(gallery_section_id, sort_order);
