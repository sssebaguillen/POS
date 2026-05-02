import { createClient } from '@/lib/supabase/server'
import InventoryPanel from '@/components/inventory/InventoryPanel'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { normalizePriceList, normalizePriceListOverride } from '@/lib/mappers'
import { fetchInventoryProducts } from '@/lib/inventory-products'

export default async function InventoryPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const viewModeCookie = cookieStore.get('inventory-view-mode')?.value
  const initialViewMode: 'grid' | 'list' = viewModeCookie === 'grid' ? 'grid' : 'list'

  const [
    { data: products, error: productsError },
    { data: categories, error: categoriesError },
    { data: brands, error: brandsError },
    { data: priceListsData, error: priceListsError },
  ] = await Promise.all([
    fetchInventoryProducts(supabase, businessId),
    supabase
      .from('categories')
      .select('id, business_id, name, icon')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('position'),
    supabase
      .from('brands')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name'),
    supabase
      .from('price_lists')
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .eq('business_id', businessId)
      .order('created_at'),
  ])

  if (productsError) {
    throw new Error(productsError.message)
  }

  if (categoriesError) {
    throw new Error(categoriesError.message)
  }

  if (brandsError) {
    throw new Error(brandsError.message)
  }

  if (priceListsError) {
    throw new Error(priceListsError.message)
  }

  const priceLists = (priceListsData ?? []).map(normalizePriceList)
  const priceListIds = priceLists.map(pl => pl.id)

  const { data: productOverridesData, error: productOverridesError } = priceListIds.length > 0
    ? await supabase
        .from('price_list_overrides')
        .select('id, price_list_id, product_id, brand_id, multiplier')
        .in('price_list_id', priceListIds)
        .not('product_id', 'is', null)
    : { data: [], error: null }

  if (productOverridesError) {
    throw new Error(productOverridesError.message)
  }

  const categoryIds = (categories ?? []).map(c => c.id).join(',')
  const brandIds = (brands ?? []).map(b => b.id).join(',')

  return (
    <InventoryPanel
      key={`${categoryIds}|${brandIds}`}
      businessId={businessId}
      operatorId={activeOperator?.profile_id ?? null}
      readOnly={activeOperator?.permissions.stock_write !== true}
      initialProducts={products ?? []}
      categories={categories ?? []}
      brands={brands ?? []}
      priceLists={priceLists}
      productOverrides={(productOverridesData ?? []).map(normalizePriceListOverride)}
      initialViewMode={initialViewMode}
    />
  )
}
