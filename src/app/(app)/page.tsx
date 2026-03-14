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
      .select('*, categories(name, icon)')
      .eq('is_active', true)
      .order('sales_count', { ascending: false }),
    supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('position'),
    supabase
      .from('price_lists')
      .select('*')
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
      .select('*')
      .in('price_list_id', priceListIds)
    priceListOverrides = (overridesData ?? []) as PriceListOverride[]
  }

  return (
    <POSView
      products={products ?? []}
      categories={categories ?? []}
      businessId={profileBusinessId}
      priceLists={(priceLists ?? []) as import('@/components/price-lists/types').PriceList[]}
      priceListOverrides={priceListOverrides}
      activeOperator={activeOperator}
    />
  )
}
