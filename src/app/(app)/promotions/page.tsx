import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { normalizePromotion } from '@/lib/promotions'
import PromotionsView from '@/components/promotions/PromotionsView'

export default async function PromotionsPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const [{ data: promotions }, { data: products }, { data: categories }, { data: brands }] = await Promise.all([
    supabase
      .from('promotions')
      .select('id, business_id, name, kind, percent, offer_price, group_size, affected_units, pay_percent, product_id, category_id, brand_id, starts_at, ends_at, is_active, show_in_catalog, archived_at, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }),
    supabase
      .from('products')
      .select('id, name, has_variants, category_id, brand_id')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('categories')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name'),
    supabase
      .from('brands')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name'),
  ])

  return (
    <PromotionsView
      businessId={businessId}
      operatorId={activeOperator?.profile_id ?? null}
      readOnly={activeOperator !== null && activeOperator.permissions.inventory_write !== true}
      initialPromotions={(promotions ?? []).map(normalizePromotion)}
      products={(products ?? []).map(p => ({
        id: p.id,
        name: p.name,
        has_variants: p.has_variants ?? false,
        category_id: p.category_id ?? null,
        brand_id: p.brand_id ?? null,
      }))}
      categories={categories ?? []}
      brands={brands ?? []}
    />
  )
}
