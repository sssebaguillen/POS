-- 20260529_10: scope product-images storage write policies to the owning business folder.
--
-- Hallazgo (no cubierto por la auditoría DB de doc 08, que solo vio tablas + RPC):
-- las policies de escritura del bucket `product-images` solo chequeaban
-- `bucket_id = 'product-images'`, sin scopear por carpeta de negocio. Como el path
-- es `{businessId}/...` (regla 23 de CLAUDE.md) pero la policy no lo exigía, cualquier
-- usuario autenticado de otro negocio podía INSERT/UPDATE/DELETE imágenes de producto
-- de CUALQUIER negocio (vandalismo / defacement del catálogo público ajeno).
--
-- Fix: mismo patrón ya usado en expense-receipts / business-logos —
-- `(storage.foldername(name))[1] = get_business_id()::text`. SELECT sigue público
-- (las imágenes son de lectura pública por diseño del catálogo).

drop policy if exists "product_images_authenticated_insert" on storage.objects;
drop policy if exists "product_images_authenticated_update" on storage.objects;
drop policy if exists "product_images_authenticated_delete" on storage.objects;

create policy "product_images_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (get_business_id())::text
  );

create policy "product_images_authenticated_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (get_business_id())::text
  );

create policy "product_images_authenticated_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (get_business_id())::text
  );
