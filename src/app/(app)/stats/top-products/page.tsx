import { createClient } from '@/lib/supabase/server'
import TopProductsDetailView from '@/components/stats/TopProductsDetailView'
import type { TopProductRow } from '@/components/stats/TopProductsDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'
import type { StatsKpis } from '@/lib/types'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  page?: string
}

export default async function TopProductsDetailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period = params.period ?? 'mes'
  const page = Number(params.page ?? 1)
  const limit = 50
  const offset = (page - 1) * limit

  const { from, to } = resolveDateRange(period, params.from, params.to)

  const [{ data: result }, { data: kpisRaw }] = await Promise.all([
    supabase.rpc('get_top_products_detail', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
      p_limit: limit,
      p_offset: offset,
    }),
    supabase.rpc('get_stats_kpis', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
    }),
  ])

  const rows = (result as unknown as { data: TopProductRow[]; total: number } | null)
  const kpis = kpisRaw as unknown as StatsKpis | null

  return (
    <TopProductsDetailView
      rows={rows?.data ?? []}
      total={rows?.total ?? 0}
      kpis={kpis}
      period={period}
      from={params.from}
      to={params.to}
      page={page}
    />
  )
}
