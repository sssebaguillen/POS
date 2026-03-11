import { createClient } from '@/lib/supabase/server'
import POSView from '@/components/pos/POSView'

export default async function POSPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let businessId: string | null = null

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    businessId = profile?.business_id ?? null
  }

  const { data: products } = await supabase
    .from('products')
    .select('*, categories(name, icon)')
    .eq('is_active', true)
    .order('sales_count', { ascending: false })

  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('position')

  return (
    <POSView
      products={products ?? []}
      categories={categories ?? []}
      businessId={businessId}
    />
  )
}
