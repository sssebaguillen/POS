import { createClient } from '@/lib/supabase/server'
import ProductsPanel from '@/components/products/ProductsPanel'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { normalizePriceList, unwrapRelation } from '@/lib/mappers'

export default async function ProductsPage() {
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const [{ data: products, error: productsError }, { data: categories, error: categoriesError }, { data: brands, error: brandsError }, { data: priceLists, error: priceListsError }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku, barcode, price, cost, stock, min_stock, is_active, category_id, categories(name, icon)')
      .eq('business_id', businessId)
      .order('name'),
    supabase
      .from('categories')
      .select('id, name, icon')
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

  return (
    <ProductsPanel
      businessId={businessId}
      initialProducts={(products ?? []).map(product => ({
        ...product,
        price: Number(product.price),
        cost: Number(product.cost),
        stock: Number(product.stock),
        min_stock: Number(product.min_stock),
        categories: unwrapRelation(product.categories),
      }))}
      categories={categories ?? []}
      brands={brands ?? []}
      defaultPriceList={priceLists ? normalizePriceList(priceLists) : null}
    />
  )
}
