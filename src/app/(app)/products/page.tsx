import { createClient } from '@/lib/supabase/server'
import ProductsPanel from '@/components/products/ProductsPanel'

export default async function ProductsPage() {
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

  const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku, barcode, price, cost, stock, min_stock, is_active, category_id, categories(name, icon)')
      .order('name'),
    supabase
      .from('categories')
      .select('id, name, icon')
      .eq('is_active', true)
      .order('position'),
  ])

  if (productsError) {
    throw new Error(productsError.message)
  }

  if (categoriesError) {
    throw new Error(categoriesError.message)
  }

  return (
    <ProductsPanel
      businessId={profileBusinessId}
      initialProducts={(products ?? []).map(product => ({
        ...product,
        price: Number(product.price),
        cost: Number(product.cost),
        stock: Number(product.stock),
        min_stock: Number(product.min_stock),
        categories: Array.isArray(product.categories)
          ? product.categories[0] ?? null
          : product.categories ?? null,
      }))}
      categories={categories ?? []}
    />
  )
}
