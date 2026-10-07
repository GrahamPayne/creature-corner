-- Creature Corner shop — Storage bucket RLS policies
--
-- Run this AFTER creating the `product-images` bucket in the Supabase
-- dashboard (Storage → New bucket → name it exactly "product-images",
-- toggle "Public bucket" ON — these are storefront product photos meant
-- for anyone to view).
--
-- Why the bucket itself must be Public (not just RLS'd): Supabase Storage's
-- public URL endpoint (what getPublicUrl() builds, and what every plain
-- <img src="..."> on the public site uses) only serves files without
-- authentication when the bucket is marked Public — it does not evaluate
-- RLS policies on storage.objects for that specific unauthenticated
-- fast path, regardless of what SELECT policies exist. A private bucket's
-- "public" URL simply 404s for anonymous requests, no matter the RLS
-- policy below — that's what broke image display before this bucket was
-- switched to Public. The SELECT policy here is kept anyway (harmless,
-- and still relevant to any access path other than the direct public URL)
-- but it is not what makes anonymous image loading work — the bucket's
-- Public flag is.
--
-- The INSERT/UPDATE/DELETE policies below are unaffected by the bucket's
-- public/private flag either way — those are always enforced by RLS
-- regardless, which is what actually keeps uploads/edits/deletes
-- admin-only. Marking the bucket Public only affects anonymous reads.
--
-- See docs/SHOP_SETUP.md for the full walkthrough.

-- Public can read any file in the product-images bucket. Reading the file
-- path alone doesn't expose which product/status it belongs to, and the
-- product_images table (which does carry that context) is already RLS'd.
create policy "product images are publicly readable"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'product-images');

create policy "only admins upload product images"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'product-images' and is_admin());

create policy "only admins update product images"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'product-images' and is_admin())
    with check (bucket_id = 'product-images' and is_admin());

create policy "only admins delete product images"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'product-images' and is_admin());
