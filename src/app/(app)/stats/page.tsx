export const runtime = 'edge'

import { createClient } from '@/lib/supabase/server'
import StatsView from '@/components/stats/StatsView'
import type { TopProductRow } from '@/components/stats/StatsView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type { OperatorSalesStatsRow, StatsKpis, StatsEvolution, StatsBreakdown } from '@/lib/types'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period = params.period ?? 'hoy'
  const { from, to } = resolveDateRange(period, params.from, params.to)

  const [{ data: kpisRaw }, { data: evolutionRaw }, { data: breakdownRaw }, { data: topProductsRaw }, { data: operatorsRaw }] =
    await Promise.all([
      supabase.rpc('get_stats_kpis', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      supabase.rpc('get_stats_evolution', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      supabase.rpc('get_stats_breakdown', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      supabase.rpc('get_top_products_detail', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
        p_limit: 8,
        p_offset: 0,
      }),
      supabase.rpc('get_sales_by_operator_detail', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
    ])

  const kpis = kpisRaw as unknown as StatsKpis | null
  const evolution = evolutionRaw as unknown as StatsEvolution | null
  const breakdown = breakdownRaw as unknown as StatsBreakdown | null
  const topProducts = (topProductsRaw as unknown as { data: TopProductRow[] } | null)?.data ?? []
  const operatorRows = (operatorsRaw as unknown as { data: OperatorSalesStatsRow[] } | null)?.data ?? []
  const operators = normalizeOperatorSalesStatsRows(operatorRows)

  return (
    <StatsView
      kpis={kpis}
      evolution={evolution}
      breakdown={breakdown}
      topProducts={topProducts}
      operators={operators}
      period={period}
      from={params.from}
      to={params.to}
    />
  )
}
