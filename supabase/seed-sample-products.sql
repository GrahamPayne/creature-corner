-- Creature Corner shop — optional sample product seed
--
-- Entirely optional. Run this in the Supabase SQL editor if you'd like
-- /shop to show the same 6 familiar test products you already reviewed in
-- Stage 3, now as real database rows you can edit/duplicate/delete through
-- /admin, instead of /shop starting completely empty.
--
-- These rows have no photos (product_images), since nothing has been
-- uploaded to the product-images Storage bucket yet — that's Stage 5. They
-- show a "No Image" placeholder until then, exactly like a real new
-- product would before you upload its photos.
--
-- Safe to re-run: skips any row whose slug already exists.

insert into products (name, slug, price_cents, short_description, description, category_id, dimensions, materials, quantity, shipping_class, pickup_available, featured, status)
select 'Recovered Specimen Painting No. 7', 'recovered-specimen-painting-no-7', 48000,
  'Original acrylic painting, recovered-artifact series.',
  'An original acrylic painting from the recovered-artifact series — framed and ready to hang.',
  (select id from categories where slug = 'original-art'),
  '16in x 20in, framed', 'Acrylic on panel, wood frame', 1, 'medium', true, true, 'available'
where not exists (select 1 from products where slug = 'recovered-specimen-painting-no-7');

insert into products (name, slug, price_cents, short_description, description, category_id, dimensions, materials, quantity, shipping_class, pickup_available, featured, status)
select 'Abyssal Bloom Terrarium', 'abyssal-bloom-terrarium', 15000,
  'Hand-sculpted alien plant specimen in a sealed terrarium.',
  'A hand-sculpted alien plant specimen, mounted in a sealed glass terrarium for display.',
  (select id from categories where slug = 'plants'),
  '6in diameter x 9in tall', 'Sculpted resin, glass, foam substrate', 1, 'medium', false, false, 'available'
where not exists (select 1 from products where slug = 'abyssal-bloom-terrarium');

insert into products (name, slug, price_cents, short_description, description, category_id, dimensions, materials, quantity, shipping_class, pickup_available, featured, status)
select 'Larval Mask No. 3', 'larval-mask-no-3', 32000,
  'Wearable sculpted mask, hand-painted finish.',
  'A wearable, hand-sculpted and hand-painted mask from the larval-form series. One of a kind.',
  (select id from categories where slug = 'masks'),
  'Fits most adult heads, 11in x 9in', 'Sculpted foam latex, acrylic paint', 1, 'medium', true, false, 'available'
where not exists (select 1 from products where slug = 'larval-mask-no-3');

insert into products (name, slug, price_cents, short_description, description, category_id, dimensions, materials, quantity, shipping_class, pickup_available, featured, status)
select 'Specimen Archive Print Set', 'specimen-archive-print-set', 4500,
  'Set of 3 archival prints from the specimen catalog.',
  'A set of three archival-quality prints pulled from the specimen catalog. Unframed.',
  (select id from categories where slug = 'prints'),
  '8in x 10in each', 'Archival matte paper', 5, 'small', true, false, 'available'
where not exists (select 1 from products where slug = 'specimen-archive-print-set');

insert into products (name, slug, price_cents, short_description, description, category_id, dimensions, materials, quantity, shipping_class, pickup_available, featured, status)
select 'Resin Tooth Charm Pair', 'resin-tooth-charm-pair', 2200,
  'Pair of small cast-resin specimen charms.',
  'A pair of small cast-resin charms, finished to look like recovered biological artifacts.',
  (select id from categories where slug = 'small-stuff'),
  '1in each', 'Cast resin, waxed cord', 2, 'small', true, false, 'available'
where not exists (select 1 from products where slug = 'resin-tooth-charm-pair');

insert into products (name, slug, price_cents, short_description, description, category_id, dimensions, materials, quantity, shipping_class, pickup_available, featured, status)
select 'Fossilized Fragment Study', 'fossilized-fragment-study', 60000,
  'Original sculpted fragment, sold.',
  'An original sculpted fragment piece from an early museum-specimen study. No longer available.',
  (select id from categories where slug = 'original-art'),
  '10in x 14in', 'Sculpted resin, mixed media', 0, 'medium', false, false, 'sold'
where not exists (select 1 from products where slug = 'fossilized-fragment-study');
