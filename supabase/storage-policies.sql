-- Creature Corner shop — Storage bucket RLS policies
--
-- Run this AFTER creating the `product-images` bucket in the Supabase
-- dashboard (Storage → New bucket → name it exactly "product-images",
-- leave it "Public bucket" OFF — these policies grant public read instead,
-- so a leaked bucket URL pattern can't be used to bypass product status).
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
