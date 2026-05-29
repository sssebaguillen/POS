-- 20260529_11: cerrar el listing anónimo de los buckets públicos.
--
-- Advisor `public_bucket_allows_listing` (product-images, business-logos): la policy
-- de SELECT otorgaba a anon (public) acceso a TODAS las filas → anon podía enumerar
-- vía la API `.list()` los paths de objetos de todos los negocios (incluye business_id).
--
-- Los buckets siguen siendo `public = true`: el render de imágenes en el catálogo y
-- el panel usa URLs públicas (getPublicUrl → /object/public/...), que se sirven por CDN
-- SIN consultar RLS. La policy de SELECT solo gobierna la API REST autenticada (`.list()`
-- y /object/authenticated). `.list()` no se usa en la app (verificado), así que scopear
-- el SELECT a authenticated + carpeta propia no rompe nada y elimina la enumeración anon.

-- product-images
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_authenticated_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (get_business_id())::text
  );

-- business-logos
drop policy if exists "logos_public_read" on storage.objects;
create policy "logos_authenticated_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] = (get_business_id())::text
  );
