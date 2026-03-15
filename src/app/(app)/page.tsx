import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import type { PriceListOverride } from '@/components/price-lists/types'
import POSView from '@/components/pos/POSView'

export default async function POSPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let profileBusinessId: string | null = null

  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    if (profileError) {
      throw new Error(profileError.message)
    }

    profileBusinessId = profile?.business_id ?? null
  }

  if (!profileBusinessId) {
    throw new Error('No se encontro business_id en el perfil del usuario autenticado')
  }

  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const [
    { data: products, error: productsError },
    { data: categories, error: categoriesError },
    { data: priceLists, error: priceListsError },
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id, business_id, name, price, cost, stock, min_stock, is_active, show_in_catalog, category_id, sku, barcode, brand_id, image_url, sales_count, created_at, brands(id, name), categories(name, icon)')
      .eq('is_active', true)
      .order('sales_count', { ascending: false }),
    supabase
      .from('categories')
      .select('id, business_id, name, icon, position, is_active')
      .eq('is_active', true)
      .order('position'),
    supabase
      .from('price_lists')
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .eq('business_id', profileBusinessId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true }),
  ])

  if (productsError) {
    throw new Error(productsError.message)
  }

  if (categoriesError) {
    throw new Error(categoriesError.message)
  }

  if (priceListsError) {
    throw new Error(priceListsError.message)
  }

  const priceListIds = (priceLists ?? []).map(pl => pl.id)
  let priceListOverrides: PriceListOverride[] = []
  if (priceListIds.length > 0) {
    const { data: overridesData } = await supabase
      .from('price_list_overrides')
      .select('id, price_list_id, product_id, brand_id, multiplier')
      .in('price_list_id', priceListIds)
    priceListOverrides = (overridesData ?? []).map(o => ({
      id: o.id,
      price_list_id: o.price_list_id,
      product_id: o.product_id,
      brand_id: o.brand_id,
      multiplier: Number(o.multiplier),
    }))
  }

  return (
    <POSView
      products={(products ?? []).map(product => ({
        ...product,
        price: Number(product.price),
        cost: Number(product.cost),
        stock: Number(product.stock),
        min_stock: Number(product.min_stock),
        sales_count: Number(product.sales_count),
        brand_id: product.brand_id ?? null,
        brand: Array.isArray(product.brands)
          ? product.brands[0] ?? null
          : product.brands ?? null,
        image_url: product.image_url ?? null,
        categories: Array.isArray(product.categories)
          ? product.categories[0] ?? null
          : product.categories ?? null,
      }))}
      categories={(categories ?? []).map(c => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
      }))}
      businessId={profileBusinessId}
      priceLists={(priceLists ?? []).map(pl => ({
        id: pl.id,
        business_id: pl.business_id,
        name: pl.name,
        description: pl.description,
        multiplier: Number(pl.multiplier),
        is_default: pl.is_default,
        created_at: pl.created_at,
      }))}
      priceListOverrides={priceListOverrides}
      activeOperator={activeOperator}
    />
  )
}
