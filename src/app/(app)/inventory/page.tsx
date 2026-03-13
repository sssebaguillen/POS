import { createClient } from '@/lib/supabase/server'
import InventoryPanel from '@/components/stock/InventoryPanel'

export default async function InventoryPage() {
  const supabase = await createClient()

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

  const { data: products } = await supabase
    .from('products')
    .select('id, business_id, name, price, cost, stock, min_stock, is_active, category_id, sku, barcode, categories(name, icon)')
    .order('name')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, business_id, name, icon')
    .eq('is_active', true)
    .order('position')

 const businessId = profileBusinessId

  return (
    <InventoryPanel
      businessId={businessId}
      initialProducts={(products ?? []).map(product => ({
        ...product,
        price: Number(product.price),
        cost: Number(product.cost),
        categories: Array.isArray(product.categories)
          ? product.categories[0] ?? null
          : product.categories ?? null,
      }))}
      categories={categories ?? []}
    />
  )
}
