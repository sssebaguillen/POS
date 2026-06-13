export const runtime = 'edge'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReportView, { type ReportData } from '@/components/stats/ReportView'
import { requireAuthenticatedBusinessId, getBusinessTimezone } from '@/lib/business'
import { getActiveOperator, hasPermission } from '@/lib/operator'
import { resolveDateRange } from '@/lib/date-utils'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type {
  DailySnapshotRow,
  OperatorSalesStatsRow,
  StatsBreakdown,
  StatsKpis,
  StatsTrendsComparison,
} from '@/lib/types'
import type { TopProductRow } from '@/components/stats/StatsView'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

const EMPTY_TOTALS = {
  from: '',
  to: '',
  net_revenue: 0,
  gross_revenue: 0,
  discounts_total: 0,
  expenses_total: 0,
  operating_expenses_total: 0,
  inventory_expenses_total: 0,
  sales_count: 0,
  items_sold: 0,
  customers_count: 0,
  avg_ticket: 0,
}

export default async function StatsReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)
  const timezone = await getBusinessTimezone(supabase, businessId)

  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  if (activeOperator && !hasPermission(activeOperator, 'reports')) {
    redirect('/pos')
  }

  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to, timezone)

  const [
    { data: business },
    { data: kpisRaw },
    { data: comparisonRaw },
    { data: breakdownRaw },
    { data: topProductsRaw },
    { data: operatorsRaw },
    { data: dailySnapshotsRaw },
  ] = await Promise.all([
    supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    supabase.rpc('get_stats_kpis', { p_business_id: businessId, p_from: from, p_to: to }),
    supabase.rpc('get_period_comparison', { p_business_id: businessId, p_from: from, p_to: to }),
    supabase.rpc('get_stats_breakdown', { p_business_id: businessId, p_from: from, p_to: to }),
    supabase.rpc('get_top_products_detail', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
      p_limit: 10,
      p_offset: 0,
    }),
    supabase.rpc('get_sales_by_operator_detail', { p_business_id: businessId, p_from: from, p_to: to }),
    supabase.rpc('get_daily_snapshots', { p_business_id: businessId, p_from: from, p_to: to }),
  ])

  const businessName =
    typeof business?.name === 'string' && business.name.trim().length > 0 ? business.name : 'Negocio'

  const comparison: StatsTrendsComparison = (comparisonRaw as unknown as StatsTrendsComparison | null) ?? {
    current: { ...EMPTY_TOTALS, from: from ?? '', to: to ?? '' },
    previous: { ...EMPTY_TOTALS },
    days: [],
  }

  const data: ReportData = {
    kpis: kpisRaw as unknown as StatsKpis | null,
    comparison,
    breakdown: breakdownRaw as unknown as StatsBreakdown | null,
    topProducts: (topProductsRaw as unknown as { data: TopProductRow[] } | null)?.data ?? [],
    operators: normalizeOperatorSalesStatsRows(
      (operatorsRaw as unknown as { data: OperatorSalesStatsRow[] } | null)?.data ?? []
    ),
    dailySnapshots: (dailySnapshotsRaw as unknown as { data: DailySnapshotRow[] } | null)?.data ?? [],
  }

  return (
    <ReportView
      businessId={businessId}
      businessName={businessName}
      data={data}
      period={period}
      from={params.from}
      to={params.to}
      timezone={timezone}
    />
  )
}
