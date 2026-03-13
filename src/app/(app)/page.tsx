import { createClient } from '@/lib/supabase/server'
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

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*, categories(name, icon)')
    .eq('is_active', true)
    .order('sales_count', { ascending: false })

  if (productsError) {
    throw new Error(productsError.message)
  }

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('position')

  if (categoriesError) {
    throw new Error(categoriesError.message)
  }

  return (
    <POSView
      products={products ?? []}
      categories={categories ?? []}
      businessId={profileBusinessId}
    />
  )
}
