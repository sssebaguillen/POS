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

  const [{ data: lists }, { data: products }, { data: variantCostRows }] = await Promise.all([
    supabase
      .from('price_lists')
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .eq('business_id', businessId)
      .order('created_at'),
    supabase
      .from('products')
      .select('id, name, cost, price, has_variants, brand_id, brands(id, name), category_id, categories(name, icon)')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('product_variants')
      .select('product_id, cost, price, is_active')
      .eq('business_id', businessId)
      .eq('is_active', true),
  ])

  const priceListIds = (lists ?? []).map(list => list.id)

  const { data: overrides } = priceListIds.length
    ? await supabase
        .from('price_list_overrides')
        .select('id, price_list_id, product_id, brand_id, multiplier')
        .in('price_list_id', priceListIds)
    : { data: [] }

  // Build min-cost and min-price maps for variant products
  const variantCostByProduct = new Map<string, { minCost: number; minPrice: number }>()
  for (const v of variantCostRows ?? []) {
    const cost = Number(v.cost)
    const price = Number(v.price)
    const existing = variantCostByProduct.get(v.product_id)
    variantCostByProduct.set(v.product_id, {
      minCost: existing ? Math.min(existing.minCost, cost > 0 ? cost : Infinity) : (cost > 0 ? cost : Infinity),
      minPrice: existing ? Math.min(existing.minPrice, price > 0 ? price : Infinity) : (price > 0 ? price : Infinity),
    })
  }

  return (
    <PriceListsPanel
      businessId={businessId}
      operatorId={activeOperator?.profile_id ?? null}
      readOnly={activeOperator !== null && activeOperator.permissions.price_lists_write !== true}
      initialLists={(lists ?? []).map(normalizePriceList)}
      products={(products ?? []).map(product => {
        const variantData = product.has_variants ? variantCostByProduct.get(product.id) : null
        const displayCost = variantData
          ? (Number.isFinite(variantData.minCost) ? variantData.minCost : 0)
          : Number(product.cost)
        const displayPrice = variantData
          ? (Number.isFinite(variantData.minPrice) ? variantData.minPrice : 0)
          : Number(product.price)
        return {
          id: product.id,
          name: product.name,
          cost: displayCost,
          price: displayPrice,
          has_variants: product.has_variants ?? false,
          brand_id: product.brand_id ?? null,
          brand: unwrapRelation(product.brands),
          category_id: product.category_id,
          categories: unwrapRelation(product.categories),
        }
      })}
      initialOverrides={(overrides ?? []).map(normalizePriceListOverride)}
    />
  )
}
