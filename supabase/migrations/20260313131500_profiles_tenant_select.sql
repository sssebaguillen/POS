-- Allow authenticated users to read profiles within their own business.
-- This is required for operator selection and owner-side operator management.
drop policy if exists profiles_tenant_select on public.profiles;

create policy profiles_tenant_select
on public.profiles
for select
using (business_id = public.get_business_id());
