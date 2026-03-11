import { createClient } from '@/lib/supabase/server'
import InventoryPanel from '@/components/stock/InventoryPanel'

export default async function InventoryPage() {
  const supabase = await createClient()

  const { data: products } = await supabase
    .from('products')
    .select('id, name, price, cost, stock, min_stock, is_active, category_id, sku, barcode, categories(name, icon)')
    .order('name')

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, icon')
    .eq('is_active', true)
    .order('position')

  return (
    <InventoryPanel
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
