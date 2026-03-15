import { createClient } from '@/lib/supabase/server'
import PriceListsPanel from '@/components/price-lists/PriceListsPanel'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'

export default async function PriceListsPage() {
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

  if (!businessId) {
    throw new Error('No se encontró el negocio asociado al usuario autenticado.')
  }

  const [{ data: lists }, { data: products }] = await Promise.all([
    supabase
      .from('price_lists')
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .eq('business_id', businessId)
      .order('created_at'),
    supabase
      .from('products')
      .select('id, name, cost, brand_id, brands(id, name), category_id, categories(name, icon)')
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
      initialLists={(lists ?? []).map(list => ({
        id: list.id,
        business_id: list.business_id,
        name: list.name,
        description: list.description,
        multiplier: Number(list.multiplier),
        is_default: list.is_default,
        created_at: list.created_at,
      }))}
      products={(products ?? []).map(product => ({
        id: product.id,
        name: product.name,
        cost: Number(product.cost),
        brand_id: product.brand_id ?? null,
        brand: Array.isArray(product.brands)
          ? product.brands[0] ?? null
          : product.brands ?? null,
        category_id: product.category_id,
        categories: Array.isArray(product.categories)
          ? product.categories[0] ?? null
          : product.categories ?? null,
      }))}
      initialOverrides={(overrides ?? []).map(override => ({
        id: override.id,
        price_list_id: override.price_list_id,
        product_id: override.product_id,
        brand_id: override.brand_id,
        multiplier: Number(override.multiplier),
      }))}
    />
  )
}
