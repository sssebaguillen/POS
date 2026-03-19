import { createClient } from '@/lib/supabase/server'
import BreakdownDetailView from '@/components/stats/BreakdownDetailView'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  tab?: string
}

export default async function BreakdownDetailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
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

  const period = params.period ?? 'mes'
  const from = params.from
  const to = params.to
  const tab = params.tab === 'brand' ? 'brand' : 'category'

  const { data: result } = await supabase.rpc('get_sales_by_category_detail', {
    p_business_id: businessId,
    p_from: from ?? null,
    p_to: to ?? null,
    p_limit: 100,
    p_offset: 0,
  })

  const rows = (result as unknown as { data: CategorySalesRow[]; total: number } | null)

  return (
    <BreakdownDetailView
      rows={rows?.data ?? []}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
      tab={tab}
    />
  )
}

interface CategorySalesRow {
  category_id: string | null
  category_name: string
  revenue: number
  units: number
  transactions: number
  distinct_products: number
}
