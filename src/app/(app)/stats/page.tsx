export const runtime = 'edge'

import { createClient } from '@/lib/supabase/server'
import StatsView from '@/components/stats/StatsView'
import type { TopProductRow } from '@/components/stats/StatsView'
import { requireAuthenticatedBusinessId, getBusinessTimezone } from '@/lib/business'
import { resolveDateRange, getAdjacentPreviousRange } from '@/lib/date-utils'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type { DailySnapshotRow, OperatorSalesStatsRow, StatsKpis, StatsEvolution, StatsBreakdown, SalesHeatmapCell, DeadStockSummary, PromoImpact, SalesBySource, MarginTotals } from '@/lib/types'

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
  const timezone = await getBusinessTimezone(supabase, businessId)

  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to, timezone)
  const prevRange = getAdjacentPreviousRange(from, to)

  const [
    { data: kpisRaw, error: kpisError },
    { data: evolutionRaw, error: evolutionError },
    { data: breakdownRaw, error: breakdownError },
    { data: topProductsRaw, error: topProductsError },
    { data: operatorsRaw, error: operatorsError },
    { data: dailySnapshotsRaw, error: dailySnapshotsError },
    { data: heatmapRaw, error: heatmapError },
    { data: deadStockRaw, error: deadStockError },
    { data: promoImpactRaw, error: promoImpactError },
    { data: salesBySourceRaw, error: salesBySourceError },
    { data: marginRaw, error: marginError },
    { data: prevMarginRaw, error: prevMarginError },
  ] =
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
      supabase.rpc('get_daily_snapshots', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      supabase.rpc('get_sales_heatmap', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      // Stock muerto: independiente del período (estado "al día de hoy"). Solo se usa el summary.
      supabase.rpc('get_dead_stock', {
        p_business_id: businessId,
        p_days_threshold: 90,
        p_bucket: null,
        p_limit: 1,
        p_offset: 0,
      }),
      supabase.rpc('get_promo_impact', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      supabase.rpc('get_sales_by_source', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
      }),
      // Margen bruto del período (solo se usa `totals`; p_limit=1 minimiza el payload de `data`).
      supabase.rpc('get_margin_analysis', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
        p_limit: 1,
        p_offset: 0,
      }),
      // Margen del período anterior (para el delta de la tarjeta).
      supabase.rpc('get_margin_analysis', {
        p_business_id: businessId,
        p_from: prevRange.from,
        p_to: prevRange.to,
        p_limit: 1,
        p_offset: 0,
      }),
    ])

  const statsError =
    kpisError ||
    evolutionError ||
    breakdownError ||
    topProductsError ||
    operatorsError ||
    dailySnapshotsError ||
    heatmapError ||
    deadStockError ||
    promoImpactError ||
    salesBySourceError ||
    marginError ||
    prevMarginError
  if (statsError) throw new Error(`stats: ${statsError.message}`)

  const kpis = kpisRaw as unknown as StatsKpis | null
  const evolution = evolutionRaw as unknown as StatsEvolution | null
  const breakdown = breakdownRaw as unknown as StatsBreakdown | null
  const topProducts = (topProductsRaw as unknown as { data: TopProductRow[] } | null)?.data ?? []
  const operatorRows = (operatorsRaw as unknown as { data: OperatorSalesStatsRow[] } | null)?.data ?? []
  const operators = normalizeOperatorSalesStatsRows(operatorRows)
  const dailySnapshots = (dailySnapshotsRaw as unknown as { data: DailySnapshotRow[] } | null)?.data ?? []
  const heatmapCells = (heatmapRaw as unknown as { data: SalesHeatmapCell[] } | null)?.data ?? []
  const deadStockSummary = (deadStockRaw as unknown as { summary: DeadStockSummary } | null)?.summary ?? null
  const promoImpact = promoImpactRaw as unknown as PromoImpact | null
  const salesBySource = salesBySourceRaw as unknown as SalesBySource | null
  const marginTotals = (marginRaw as unknown as { totals: MarginTotals } | null)?.totals ?? null
  const prevMarginTotals = (prevMarginRaw as unknown as { totals: MarginTotals } | null)?.totals ?? null

  return (
    <StatsView
      businessId={businessId}
      kpis={kpis}
      evolution={evolution}
      breakdown={breakdown}
      topProducts={topProducts}
      operators={operators}
      dailySnapshots={dailySnapshots}
      heatmapCells={heatmapCells}
      deadStockSummary={deadStockSummary}
      promoImpact={promoImpact}
      salesBySource={salesBySource}
      marginTotals={marginTotals}
      prevMarginTotals={prevMarginTotals}
      period={period}
      from={params.from}
      to={params.to}
      timezone={timezone}
    />
  )
}
