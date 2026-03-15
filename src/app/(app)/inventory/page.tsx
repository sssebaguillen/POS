import { createClient } from '@/lib/supabase/server'
import InventoryPanel from '@/components/stock/InventoryPanel'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'

export default async function InventoryPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let profileBusinessId: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    profileBusinessId = profile?.business_id ?? null
  }

  const businessId = profileBusinessId

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
        brand: Array.isArray(product.brands)
          ? product.brands[0] ?? null
          : product.brands ?? null,
        categories: Array.isArray(product.categories)
          ? product.categories[0] ?? null
          : product.categories ?? null,
      }))}
      categories={categories ?? []}
      brands={brands ?? []}
      defaultPriceList={defaultPriceList ? {
        id: defaultPriceList.id,
        business_id: defaultPriceList.business_id,
        name: defaultPriceList.name,
        description: defaultPriceList.description,
        multiplier: Number(defaultPriceList.multiplier),
        is_default: defaultPriceList.is_default,
        created_at: defaultPriceList.created_at,
      } : null}
      productOverrides={(productOverrides ?? []).map(override => ({
        id: override.id,
        price_list_id: override.price_list_id,
        product_id: override.product_id,
        brand_id: override.brand_id,
        multiplier: Number(override.multiplier),
      }))}
    />
  )
}
