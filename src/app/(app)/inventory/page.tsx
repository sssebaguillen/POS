import { createClient } from '@/lib/supabase/server'
import InventoryPanel from '@/components/stock/InventoryPanel'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { normalizePriceList, normalizePriceListOverride, unwrapRelation } from '@/lib/mappers'

export default async function InventoryPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const [
    { data: products },
    { data: categories },
    { data: brands },
    { data: defaultPriceList },
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id, business_id, name, price, cost, stock, min_stock, is_active, show_in_catalog, category_id, sku, barcode, brand_id, brands(id, name), categories(name, icon)')
      .eq('business_id', businessId)
      .order('name'),
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
      .eq('is_default', true)
      .maybeSingle(),
  ])

  const { data: productOverrides } = defaultPriceList
    ? await supabase
        .from('price_list_overrides')
        .select('id, price_list_id, product_id, brand_id, multiplier')
        .eq('price_list_id', defaultPriceList.id)
        .not('product_id', 'is', null)
    : { data: [] }

  return (
    <InventoryPanel
      businessId={businessId}
      operatorId={activeOperator?.profile_id ?? null}
      readOnly={activeOperator?.permissions.stock_write !== true}
      initialProducts={(products ?? []).map(product => ({
        ...product,
        price: Number(product.price),
        cost: Number(product.cost),
        brand_id: product.brand_id ?? null,
        brand: unwrapRelation(product.brands),
        categories: unwrapRelation(product.categories),
      }))}
      categories={categories ?? []}
      brands={brands ?? []}
      defaultPriceList={defaultPriceList ? normalizePriceList(defaultPriceList) : null}
      productOverrides={(productOverrides ?? []).map(normalizePriceListOverride)}
    />
  )
}
