import { createClient } from '@/lib/supabase/server'
import BreakdownDetailView from '@/components/stats/BreakdownDetailView'
import type { CategorySalesRow, BrandRow } from '@/components/stats/BreakdownDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'

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
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period = params.period ?? 'mes'
  const tab = params.tab === 'brand' ? 'brand' : 'category'
  const { from, to } = resolveDateRange(period, params.from, params.to)

  let rows: CategorySalesRow[] | BrandRow[]
  if (tab === 'brand') {
    const { data: result } = await supabase.rpc('get_sales_by_brand_detail', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
      p_limit: 100,
      p_offset: 0,
    })
    rows = (result as unknown as { data: BrandRow[] } | null)?.data ?? []
  } else {
    const { data: result } = await supabase.rpc('get_sales_by_category_detail', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
      p_limit: 100,
      p_offset: 0,
    })
    rows = (result as unknown as { data: CategorySalesRow[] } | null)?.data ?? []
  }

  return (
    <BreakdownDetailView
      rows={rows}
      period={period}
      from={params.from}
      to={params.to}
      tab={tab}
    />
  )
}
