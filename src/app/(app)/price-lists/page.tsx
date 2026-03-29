import { createClient } from '@/lib/supabase/server'
import PriceListsPanel from '@/components/price-lists/PriceListsPanel'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { normalizePriceList, normalizePriceListOverride, unwrapRelation } from '@/lib/mappers'

export default async function PriceListsPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const [{ data: lists }, { data: products }] = await Promise.all([
    supabase
      .from('price_lists')
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .eq('business_id', businessId)
      .order('created_at'),
    supabase
      .from('products')
      .select('id, name, cost, price, brand_id, brands(id, name), category_id, categories(name, icon)')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name'),
  ])

  const priceListIds = (lists ?? []).map(list => list.id)

  const { data: overrides } = priceListIds.length
    ? await supabase
        .from('price_list_overrides')
        .select('id, price_list_id, product_id, brand_id, multiplier')
        .in('price_list_id', priceListIds)
    : { data: [] }

  return (
    <PriceListsPanel
      businessId={businessId}
      readOnly={activeOperator?.permissions.price_lists_write !== true}
      initialLists={(lists ?? []).map(normalizePriceList)}
      products={(products ?? []).map(product => ({
        id: product.id,
        name: product.name,
        cost: Number(product.cost),
        price: Number(product.price),
        brand_id: product.brand_id ?? null,
        brand: unwrapRelation(product.brands),
        category_id: product.category_id,
        categories: unwrapRelation(product.categories),
      }))}
      initialOverrides={(overrides ?? []).map(normalizePriceListOverride)}
    />
  )
}
