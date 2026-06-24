'use client'

import { useMemo, useState, memo } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { TrendDown, TrendUp, CurrencyDollar, ShoppingBag, Receipt, Hash, FileText, Package, CaretRight, Coins, CircleNotch, Warning, UsersThree, ChartBar, Clock, Tag } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'
import PageHeader from '@/components/shared/PageHeader'
import InsightSurfaceAnchor from '@/components/insights/InsightSurfaceAnchor'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import { buildDateParams, periodNeedsCustomDates, resolveDateRange, getAdjacentPreviousRange, type DateRangePeriod } from '@/lib/date-utils'
import { isPaymentMethod, normalizePayment, PAYMENT_BAR_COLORS } from '@/lib/payments'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type {
  DailySnapshotRow, OperatorSalesStatsRow, StatsKpis, StatsEvolution, StatsBreakdown, SalesHeatmapCell, DeadStockSummary, PromoImpact, SalesBySource, MarginTotals,
} from '@/lib/types'
import { SALE_SOURCE_LABELS } from '@/lib/constants/domain'
import { promoBadgeLabel } from '@/lib/promotions'
import SalesHeatmap from '@/components/stats/SalesHeatmap'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

type EvolutionMode = 'revenue' | 'units'
type RankingMode = 'amount' | 'units'
type BreakdownMode = 'category' | 'brand'
type OperatorMode = 'amount' | 'transactions'

function getWidgetToggleClass(isActive: boolean): string {
  return cn(
    'pill-tab border border-transparent transition-[transform,color,border-color] duration-150 ease-[var(--ease-out)]',
    isActive && 'bg-primary/10 text-primary border-primary/20 dark:bg-primary/15 dark:border-primary/30'
  )
}

// Drill-in link shared by every widget header ("Ver detalle").
// -my-1 py-1 grows the tap target without shifting the header baseline.
const WIDGET_LINK_CLASS = 'inline-flex items-center text-xs text-primary font-medium hover:underline whitespace-nowrap -my-1 py-1'

// Empty state for a widget that has no data for the active period.
// Says what will appear here (onboarding through state, not a separate tutorial),
// with an icon for visual interest. No CTA: copy stays correct whether the user
// is brand-new or just looking at a quiet period.
function EmptyWidget({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: React.ComponentType<{ size?: number }>
  title: string
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center gap-1.5 py-8 px-4', className)}>
      <span className="h-9 w-9 rounded-xl bg-muted/70 flex items-center justify-center text-hint">
        <Icon size={18} />
      </span>
      <p className="text-sm font-medium text-body">{title}</p>
      {hint && <p className="text-xs text-hint max-w-[34ch] leading-relaxed">{hint}</p>}
    </div>
  )
}

export interface TopProductRow {
  id: string
  name: string
  units_sold: number
  revenue: number
}

interface StatsQueryData {
  kpis: StatsKpis | null
  evolution: StatsEvolution | null
  breakdown: StatsBreakdown | null
  topProducts: TopProductRow[]
  operators: OperatorSalesStatsRow[]
  dailySnapshots: DailySnapshotRow[]
  heatmapCells: SalesHeatmapCell[]
  promoImpact: PromoImpact | null
  salesBySource: SalesBySource | null
  marginTotals: MarginTotals | null
  prevMarginTotals: MarginTotals | null
}

interface Props {
  businessId: string
  kpis: StatsKpis | null
  evolution: StatsEvolution | null
  breakdown: StatsBreakdown | null
  topProducts: TopProductRow[]
  operators: OperatorSalesStatsRow[]
  dailySnapshots: DailySnapshotRow[]
  heatmapCells: SalesHeatmapCell[]
  deadStockSummary: DeadStockSummary | null
  promoImpact: PromoImpact | null
  salesBySource: SalesBySource | null
  marginTotals: MarginTotals | null
  prevMarginTotals: MarginTotals | null
  period: string
  from?: string
  to?: string
  timezone: string
}

function formatSnapshotLabel(snapshotDate: string): string {
  const [year, month, day] = snapshotDate.split('-')
  if (!year || !month || !day) return snapshotDate
  return `${day}/${month}`
}

const DeltaBadge = memo(function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null
  const delta = ((current - previous) / previous) * 100
  const positive = delta >= 0
  return (
    <div
      className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
        positive
          ? 'bg-success/10 text-success'
          : 'bg-destructive/10 text-destructive'
      }`}
    >
      {positive ? <TrendUp size={12} /> : <TrendDown size={12} />}
      {positive ? '+' : ''}{delta.toFixed(1)}%
    </div>
  )
})

export default function StatsView({
  businessId,
  kpis: initialKpis,
  evolution: initialEvolution,
  breakdown: initialBreakdown,
  topProducts: initialTopProducts,
  operators: initialOperators,
  dailySnapshots: initialDailySnapshots,
  heatmapCells: initialHeatmapCells,
  deadStockSummary,
  promoImpact: initialPromoImpact,
  salesBySource: initialSalesBySource,
  marginTotals: initialMarginTotals,
  prevMarginTotals: initialPrevMarginTotals,
  period: initialPeriod,
  from: initialFrom,
  to: initialTo,
  timezone,
}: Props) {
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])

  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('revenue')
  const [rankingMode, setRankingMode] = useState<RankingMode>('amount')
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('category')
  const [operatorMode, setOperatorMode] = useState<OperatorMode>('amount')

  const [period, setPeriod] = useState<DateRangePeriod>(initialPeriod as DateRangePeriod)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [mountedAt] = useState(() => Date.now())

  const isInitialPeriod = period === initialPeriod && from === initialFrom && to === initialTo

  const { data, isFetching } = useQuery<StatsQueryData>({
    queryKey: ['stats', businessId, period, from, to],
    queryFn: async () => {
      const resolvedRange = resolveDateRange(period, from, to, timezone)
      const prevRange = getAdjacentPreviousRange(resolvedRange.from, resolvedRange.to)
      const [kpisResult, evolutionResult, breakdownResult, topProductsResult, operatorsResult, dailySnapshotsResult, heatmapResult, promoImpactResult, salesBySourceResult, marginResult, prevMarginResult] = await Promise.all([
        supabase.rpc('get_stats_kpis', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_stats_evolution', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_stats_breakdown', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_top_products_detail', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
          p_limit: 8,
          p_offset: 0,
        }),
        supabase.rpc('get_sales_by_operator_detail', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_daily_snapshots', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_sales_heatmap', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_promo_impact', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_sales_by_source', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
        }),
        supabase.rpc('get_margin_analysis', {
          p_business_id: businessId,
          p_from: resolvedRange.from,
          p_to: resolvedRange.to,
          p_limit: 1,
          p_offset: 0,
        }),
        supabase.rpc('get_margin_analysis', {
          p_business_id: businessId,
          p_from: prevRange.from,
          p_to: prevRange.to,
          p_limit: 1,
          p_offset: 0,
        }),
      ])

      return {
        kpis: kpisResult.data as unknown as StatsKpis | null,
        evolution: evolutionResult.data as unknown as StatsEvolution | null,
        breakdown: breakdownResult.data as unknown as StatsBreakdown | null,
        topProducts: (topProductsResult.data as unknown as { data: TopProductRow[] } | null)?.data ?? [],
        operators: normalizeOperatorSalesStatsRows(
          (operatorsResult.data as unknown as { data: unknown[] } | null)?.data ?? []
        ),
        dailySnapshots: (dailySnapshotsResult.data as unknown as { data: DailySnapshotRow[] } | null)?.data ?? [],
        heatmapCells: (heatmapResult.data as unknown as { data: SalesHeatmapCell[] } | null)?.data ?? [],
        promoImpact: promoImpactResult.data as unknown as PromoImpact | null,
        salesBySource: salesBySourceResult.data as unknown as SalesBySource | null,
        marginTotals: (marginResult.data as unknown as { totals: MarginTotals } | null)?.totals ?? null,
        prevMarginTotals: (prevMarginResult.data as unknown as { totals: MarginTotals } | null)?.totals ?? null,
      }
    },
    initialData: isInitialPeriod
      ? {
          kpis: initialKpis,
          evolution: initialEvolution,
          breakdown: initialBreakdown,
          topProducts: initialTopProducts,
          operators: initialOperators,
          dailySnapshots: initialDailySnapshots,
          heatmapCells: initialHeatmapCells,
          promoImpact: initialPromoImpact,
          salesBySource: initialSalesBySource,
          marginTotals: initialMarginTotals,
          prevMarginTotals: initialPrevMarginTotals,
        }
      : undefined,
    initialDataUpdatedAt: isInitialPeriod ? mountedAt : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const kpis = data?.kpis ?? null
  const evolution = data?.evolution ?? null
  const breakdown = data?.breakdown ?? null
  const topProducts = data?.topProducts ?? []
  const operators = data?.operators ?? []
  const dailySnapshots = data?.dailySnapshots ?? []
  const heatmapCells = data?.heatmapCells ?? []
  const promoImpact = data?.promoImpact ?? null
  const salesBySource = data?.salesBySource ?? null

  function syncDateUrl(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    if (typeof window === 'undefined') return
    const query = buildDateParams(nextPeriod, nextFrom, nextTo)
    window.history.replaceState(window.history.state, '', `${pathname}?${query}`)
  }

  function handlePeriodChange(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    const resolvedFrom = periodNeedsCustomDates(nextPeriod) ? nextFrom : undefined
    const resolvedTo = periodNeedsCustomDates(nextPeriod) ? nextTo : undefined
    setPeriod(nextPeriod)
    setFrom(resolvedFrom)
    setTo(resolvedTo)
    syncDateUrl(nextPeriod, resolvedFrom, resolvedTo)
  }

  const totalRevenue = kpis?.total_revenue ?? 0
  const totalUnits = kpis?.total_units ?? 0
  const totalSales = kpis?.total_sales ?? 0
  const avgTicket = kpis?.avg_ticket ?? 0
  const prevRevenue = kpis?.prev_total_revenue ?? 0
  const prevUnits = kpis?.prev_total_units ?? 0
  const prevSales = kpis?.prev_total_sales ?? 0
  const prevAvgTicket = (kpis?.prev_total_sales ?? 0) > 0
    ? (kpis?.prev_total_revenue ?? 0) / (kpis?.prev_total_sales ?? 1)
    : 0

  const marginTotals = data?.marginTotals ?? null
  const prevMarginTotals = data?.prevMarginTotals ?? null
  const grossProfit = marginTotals?.gross_profit ?? 0
  const marginPct = marginTotals?.margin_pct ?? null
  const prevGrossProfit = prevMarginTotals?.gross_profit ?? 0
  const productsWithoutCost = marginTotals?.products_without_cost ?? 0

  const evolutionData = (evolution?.data ?? []).map(p => ({
    label: p.label,
    currentRevenue: p.revenue ?? 0,
    currentUnits: p.count ?? 0,
    previousRevenue: p.prev_revenue ?? 0,
    previousUnits: p.prev_count ?? 0,
  }))

  const dayOfWeekData = (kpis?.day_of_week ?? [])
    .sort((a, b) => {
      const order = [1, 2, 3, 4, 5, 6, 0]
      return order.indexOf(a.dow) - order.indexOf(b.dow)
    })
    .map(d => ({ day: d.label, revenue: d.revenue ?? 0 }))

  const paymentBreakdown = (() => {
    const rows = breakdown?.by_payment ?? []
    const total = rows.reduce((acc, r) => acc + (r.revenue ?? 0), 0)
    return rows
      .map(r => ({ method: r.method, amount: r.revenue ?? 0, percent: total > 0 ? ((r.revenue ?? 0) / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
  })()

  const breakdownData = (() => {
    const rows = breakdownMode === 'category'
      ? (breakdown?.by_category ?? []).map(r => ({ label: r.category_name || 'Sin categoría', value: r.revenue ?? 0 }))
      : (breakdown?.by_brand ?? []).map(r => ({ label: r.brand_name || 'Sin marca', value: r.revenue ?? 0 }))
    const total = rows.reduce((acc, r) => acc + r.value, 0)
    return rows
      .map(r => ({ ...r, percent: total > 0 ? (r.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  })()

  const sortedTopProducts = [...topProducts]
    .sort((a, b) => rankingMode === 'amount' ? (b.revenue ?? 0) - (a.revenue ?? 0) : (b.units_sold ?? 0) - (a.units_sold ?? 0))

  const sortedOperators = [...operators]
    .sort((a, b) =>
      operatorMode === 'amount'
        ? (b.total_revenue ?? 0) - (a.total_revenue ?? 0)
        : (b.transactions ?? 0) - (a.transactions ?? 0)
    )
    .slice(0, 5)

  const promoTotals = promoImpact?.totals ?? null
  const promoRows = promoImpact?.data ?? []
  const promoShare = promoTotals && promoTotals.total_sales_count > 0
    ? (promoTotals.promo_sales_count / promoTotals.total_sales_count) * 100
    : 0

  // Segmentación de canal: Mostrador (pos) vs Pedido online (catalog)
  const sourceTotalCount = salesBySource?.total.count ?? 0
  const catalogShare = salesBySource && sourceTotalCount > 0
    ? (salesBySource.catalog.count / sourceTotalCount) * 100
    : 0
  const posShare = salesBySource && sourceTotalCount > 0
    ? (salesBySource.pos.count / sourceTotalCount) * 100
    : 0
  const showSalesChannel = !!salesBySource && salesBySource.catalog.count > 0

  const snapshotTrendData = dailySnapshots.map(snapshot => ({
    label: formatSnapshotLabel(snapshot.snapshot_date),
    snapshotDate: snapshot.snapshot_date,
    netRevenue: snapshot.net_revenue ?? 0,
    expenses: snapshot.expenses_total ?? 0,
    salesCount: snapshot.sales_count ?? 0,
  }))

  const snapshotTotals = snapshotTrendData.reduce(
    (acc, row) => ({
      netRevenue: acc.netRevenue + row.netRevenue,
      expenses: acc.expenses + row.expenses,
      salesCount: acc.salesCount + row.salesCount,
    }),
    { netRevenue: 0, expenses: 0, salesCount: 0 }
  )

  const bestRevenueDay = snapshotTrendData.reduce<null | typeof snapshotTrendData[number]>(
    (best, row) => {
      if (!best || row.netRevenue > best.netRevenue) return row
      return best
    },
    null
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Estadísticas">
        <InsightSurfaceAnchor surfaces={['stats']} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        {/* Period toolbar — sticky so the active range stays visible while scrolling */}
        <div className="sticky top-0 z-10 bg-surface border-b border-edge/60 px-5 py-3">
          <div className="flex items-center gap-4">
            <DateRangeFilter
              value={period}
              from={from}
              to={to}
              onChange={handlePeriodChange}
            />
            {isFetching && (
              <span className="flex items-center gap-1.5 text-xs text-hint shrink-0">
                <CircleNotch size={13} className="animate-spin" />
                Actualizando...
              </span>
            )}
            <Link
              href={`/stats/report?period=${period}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
              className="ml-auto inline-flex items-center gap-1.5 pill-tab border border-edge text-body hover:border-primary/30 hover:text-primary transition-[transform,color,border-color] duration-150 ease-[var(--ease-out)] shrink-0"
            >
              <FileText size={15} />
              Reporte PDF
            </Link>
          </div>
        </div>

        <div className="px-5 pt-5 pb-6 space-y-5">
          <div className={`space-y-5 transition-opacity duration-200 ${isFetching ? 'opacity-50 pointer-events-none' : ''}`} aria-busy={isFetching}>
            {/* Banda-resumen: orienta antes de bajar al detalle. Densa y dividida a
                propósito — distinta de las tarjetas con sparkline del Resumen (/dashboard)
                para no duplicar su identidad. En /stats el "héroe" son los gráficos de abajo. */}
            <div className="surface-card overflow-hidden">
              <div className="flex flex-col xl:flex-row divide-y xl:divide-y-0 xl:divide-x divide-edge/60">
                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-1.5">
                  <p className="text-label text-hint flex items-center gap-1.5">
                    <CurrencyDollar size={13} className="shrink-0" />
                    Ingresos
                  </p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none tabular-nums" value={formatMoney(totalRevenue)} />
                  <DeltaBadge current={totalRevenue} previous={prevRevenue} />
                </div>
                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-1.5">
                  <p className="text-label text-hint flex items-center gap-1.5">
                    <Coins size={13} className="shrink-0" />
                    Margen bruto
                  </p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none tabular-nums" value={formatMoney(grossProfit)} />
                  <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                    <DeltaBadge current={grossProfit} previous={prevGrossProfit} />
                    {marginPct != null && (
                      <span className={cn('text-[11px]', productsWithoutCost > 0 ? 'text-warning' : 'text-hint')}>
                        {productsWithoutCost > 0 && <Warning size={11} weight="fill" className="inline mr-0.5 -mt-0.5" />}
                        {marginPct.toFixed(1)}% de margen
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-1.5">
                  <p className="text-label text-hint flex items-center gap-1.5">
                    <ShoppingBag size={13} className="shrink-0" />
                    Unidades
                  </p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none tabular-nums" value={String(totalUnits)} />
                  <DeltaBadge current={totalUnits} previous={prevUnits} />
                </div>
                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-1.5">
                  <p className="text-label text-hint flex items-center gap-1.5">
                    <Receipt size={13} className="shrink-0" />
                    Ticket prom.
                  </p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none tabular-nums" value={formatMoney(avgTicket)} />
                  <DeltaBadge current={avgTicket} previous={prevAvgTicket} />
                </div>
                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-1.5">
                  <p className="text-label text-hint flex items-center gap-1.5">
                    <Hash size={13} className="shrink-0" />
                    Transacciones
                  </p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none tabular-nums" value={totalSales.toLocaleString('es-AR')} />
                  <DeltaBadge current={totalSales} previous={prevSales} />
                </div>
              </div>
            </div>

            {/* Accesos a otras pantallas (navegación, debajo de los números) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Stock inmovilizado — estado actual, independiente del período */}
              {deadStockSummary && (
                <Link
                  href="/stats/inventory-health"
                  className="surface-card flex items-center gap-4 p-4 hover:border-primary/30 transition-colors group"
                >
                  <span
                    className={cn(
                      'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                      deadStockSummary.products_flagged > 0
                        ? 'bg-warning/10 text-warning'
                        : 'bg-muted text-body'
                    )}
                  >
                    <Package size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {deadStockSummary.products_flagged > 0 ? (
                      <>
                        <p className="text-sm font-semibold text-heading">
                          {formatMoney(deadStockSummary.total_frozen_capital)} inmovilizados
                        </p>
                        <p className="text-xs text-hint">
                          {deadStockSummary.products_flagged} {deadStockSummary.products_flagged === 1 ? 'producto sin rotación' : 'productos sin rotación'} · estado actual
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-heading">Tu inventario rota bien</p>
                        <p className="text-xs text-hint">Sin stock inmovilizado · estado actual</p>
                      </>
                    )}
                  </div>
                  <CaretRight size={18} className="text-hint group-hover:text-primary transition-colors shrink-0" />
                </Link>
              )}

              {/* Analítica de clientes — su propia pantalla */}
              <Link
                href={`/stats/customers?period=${period}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
                className="surface-card flex items-center gap-4 p-4 hover:border-primary/30 transition-colors group"
              >
                <span className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-muted text-body">
                  <UsersThree size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-heading">Analítica de clientes</p>
                  <p className="text-xs text-hint">Quién te compra más: ranking por facturación, frecuencia y última compra</p>
                </div>
                <CaretRight size={18} className="text-hint group-hover:text-primary transition-colors shrink-0" />
              </Link>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
              {/* Evolution chart */}
              <div className="surface-card p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-heading font-display">Evolución</p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEvolutionMode('revenue')}
                      className={getWidgetToggleClass(evolutionMode === 'revenue')}
                    >
                      $ Ingresos
                    </button>
                    <button
                      type="button"
                      onClick={() => setEvolutionMode('units')}
                      className={getWidgetToggleClass(evolutionMode === 'units')}
                    >
                      Unidades
                    </button>
                  </div>
                </div>

                {evolutionData.length === 0 ? (
                  <EmptyWidget
                    icon={TrendUp}
                    title="Sin ventas en el período"
                    hint="Aquí aparece la evolución de tus ingresos y unidades, comparada con el período anterior."
                    className="h-48 py-0"
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-5 text-xs text-hint">
                      <span className="flex items-center gap-1.5">
                        <svg width="16" height="3" viewBox="0 0 16 3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke="var(--primary)" strokeWidth="2" /></svg>
                        Período actual
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg width="16" height="3" viewBox="0 0 16 3"><line x1="0" y1="1.5" x2="16" y2="1.5" style={{ stroke: 'var(--color-hint)' }} strokeWidth="2" strokeDasharray="4 4" /></svg>
                        Período anterior
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart
                        data={evolutionData}
                        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-edge)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                          interval={evolutionData.length > 14 ? Math.floor(evolutionData.length / 7) : 0}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                          tickFormatter={v =>
                            evolutionMode === 'revenue'
                              ? v >= 1000 ? formatMoney(v / 1000) + 'k' : formatMoney(v)
                              : String(v)
                          }
                          width={52}
                          tickCount={5}
                        />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null
                            const ck = evolutionMode === 'revenue' ? 'currentRevenue' : 'currentUnits'
                            const pk = evolutionMode === 'revenue' ? 'previousRevenue' : 'previousUnits'
                            const fmt = (v: number) =>
                              evolutionMode === 'revenue'
                                ? formatMoney(v)
                                : String(v)
                            const cur = payload.find(p => p.dataKey === ck)
                            const prev = payload.find(p => p.dataKey === pk)
                            return (
                              <div className="surface-elevated rounded-xl p-3 text-xs space-y-1 shadow-sm">
                                <p className="font-semibold text-heading">{label}</p>
                                {cur && <p className="text-body">Actual: <span className="font-medium">{fmt(Number(cur.value))}</span></p>}
                                {prev && <p className="text-hint">Anterior: {fmt(Number(prev.value))}</p>}
                              </div>
                            )
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey={evolutionMode === 'revenue' ? 'currentRevenue' : 'currentUnits'}
                          stroke="var(--primary)"
                          strokeWidth={2}
                          dot={false}
                          name="Actual"
                        />
                        <Line
                          type="monotone"
                          dataKey={evolutionMode === 'revenue' ? 'previousRevenue' : 'previousUnits'}
                          stroke="var(--color-hint)"
                          strokeWidth={1.5}
                          strokeDasharray="5 5"
                          dot={false}
                          name="Anterior"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>

              {/* Payment methods */}
              <div className="surface-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-heading font-display">Métodos de pago</p>
                  <Link href="/stats/payment-methods" className={WIDGET_LINK_CLASS}>
                    Ver detalle →
                  </Link>
                </div>
                {paymentBreakdown.length === 0 ? (
                  <EmptyWidget
                    icon={CurrencyDollar}
                    title="Sin cobros en el período"
                    hint="Aquí se reparte tu facturación por método de pago."
                  />
                ) : (
                  paymentBreakdown.map(row => (
                    <div key={row.method} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-body font-medium">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${isPaymentMethod(row.method) ? PAYMENT_BAR_COLORS[row.method] : 'bg-hint'}`} />
                          {normalizePayment(row.method)}
                        </span>
                        <span className="text-subtle text-xs">{row.percent.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-alt">
                        <div className={`h-2 rounded-full ${isPaymentMethod(row.method) ? PAYMENT_BAR_COLORS[row.method] : 'bg-hint'}`} style={{ width: `${row.percent}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Daily snapshot trend */}
            <div className="surface-card p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Ingresos vs gastos diarios</p>
                    <Link
                      href={`/stats/trends?period=${period}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
                      className={WIDGET_LINK_CLASS}
                    >
                      Ver detalle →
                    </Link>
                  </div>
                  <p className="text-sm text-hint">
                    Tus ingresos comparados con tus gastos, día a día en el período.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
                  <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                    <p className="text-label text-hint">Ingresos netos</p>
                    <p className="text-sm font-semibold text-heading">{formatMoney(snapshotTotals.netRevenue)}</p>
                  </div>
                  <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                    <p className="text-label text-hint">Gastos</p>
                    <p className="text-sm font-semibold text-heading">{formatMoney(snapshotTotals.expenses)}</p>
                  </div>
                  <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                    <p className="text-label text-hint">Mejor día</p>
                    <p className="text-sm font-semibold text-heading">
                      {bestRevenueDay ? `${bestRevenueDay.label} · ${formatMoney(bestRevenueDay.netRevenue)}` : 'Sin datos'}
                    </p>
                  </div>
                </div>
              </div>

              {snapshotTrendData.length === 0 ? (
                <EmptyWidget
                  icon={Coins}
                  title="Sin movimientos en el período"
                  hint="Aquí se comparan tus ingresos contra tus gastos, día a día."
                  className="h-48 py-0"
                />
              ) : (
                <>
                  <div className="flex items-center gap-5 text-xs text-hint">
                    <span className="flex items-center gap-1.5">
                      <svg width="16" height="3" viewBox="0 0 16 3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke="var(--primary)" strokeWidth="2" /></svg>
                      Ingresos netos
                    </span>
                    <span className="flex items-center gap-1.5">
                      <svg width="16" height="3" viewBox="0 0 16 3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke="var(--destructive)" strokeWidth="2" /></svg>
                      Gastos
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={snapshotTrendData}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-edge)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                      interval={snapshotTrendData.length > 14 ? Math.floor(snapshotTrendData.length / 7) : 0}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                      tickFormatter={v => (v >= 1000 ? `${formatMoney(v / 1000)}k` : formatMoney(v))}
                      width={52}
                      tickCount={5}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const netRevenuePayload = payload.find(item => item.dataKey === 'netRevenue')
                        const expensesPayload = payload.find(item => item.dataKey === 'expenses')
                        const salesCountPayload = payload.find(item => item.dataKey === 'salesCount')

                        return (
                          <div className="surface-elevated rounded-xl p-3 text-xs space-y-1 shadow-sm">
                            <p className="font-semibold text-heading">{label}</p>
                            <p className="text-body">
                              Ingresos: <span className="font-medium">{formatMoney(Number(netRevenuePayload?.value ?? 0))}</span>
                            </p>
                            <p className="text-body">
                              Gastos: <span className="font-medium">{formatMoney(Number(expensesPayload?.value ?? 0))}</span>
                            </p>
                            <p className="text-hint">
                              Ventas: {Number(salesCountPayload?.payload?.salesCount ?? 0)}
                            </p>
                          </div>
                        )
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="netRevenue"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      name="Ingresos netos"
                    />
                    <Line
                      type="monotone"
                      dataKey="expenses"
                      stroke="var(--destructive)"
                      strokeWidth={2}
                      dot={false}
                      name="Gastos"
                    />
                  </LineChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>

            {/* Sales heatmap (P11.3) + Day of week distribution */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="surface-card p-6 space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Heatmap por día y hora</p>
                    <Link
                      href={`/stats/heatmap?period=${period}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
                      className={WIDGET_LINK_CLASS}
                    >
                      Ver detalle →
                    </Link>
                  </div>
                  <p className="text-sm text-hint">
                    Concentración de ventas en hora local. Útil para detectar horas pico y bajones.
                  </p>
                </div>
                {heatmapCells.length === 0 ? (
                  <EmptyWidget
                    icon={Clock}
                    title="Sin ventas en el período"
                    hint="Aquí se marcan tus horas y días pico de venta."
                    className="h-32 py-0"
                  />
                ) : (
                  <SalesHeatmap cells={heatmapCells} metric="sales_count" compact />
                )}
              </div>

              <div className="surface-card p-6 space-y-4">
                <p className="font-semibold text-heading font-display">Distribución por día</p>
                {dayOfWeekData.length === 0 || totalSales === 0 ? (
                  <EmptyWidget
                    icon={ChartBar}
                    title="Sin datos para el período"
                    hint="Aquí se distribuye tu facturación por día de la semana."
                    className="h-24 py-0"
                  />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dayOfWeekData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-edge)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--color-hint)' }} />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                        tickFormatter={v => v >= 1000 ? formatMoney(v / 1000) + 'k' : formatMoney(v)}
                        width={50}
                      />
                      <Tooltip
                        cursor={{ fill: 'color-mix(in srgb, var(--primary) 5%, transparent)' }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null
                          return (
                            <div className="surface-elevated rounded-xl p-2.5 text-xs shadow-sm">
                              <p className="font-semibold text-heading">{label}</p>
                              <p className="text-body">{formatMoney(Number(payload[0]?.value ?? 0))}</p>
                            </div>
                          )
                        }}
                      />
                      <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Operator + Ranking + Breakdown row (1/3 each) */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {/* Operator sales widget */}
              <div className="surface-card p-6 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Ventas por operador</p>
                    <Link href="/stats/operators" className={WIDGET_LINK_CLASS}>
                      Ver detalle →
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setOperatorMode('amount')}
                      className={getWidgetToggleClass(operatorMode === 'amount')}
                    >
                      $ Monto
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperatorMode('transactions')}
                      className={getWidgetToggleClass(operatorMode === 'transactions')}
                    >
                      Operaciones
                    </button>
                  </div>
                </div>
                {sortedOperators.length === 0 ? (
                  <EmptyWidget
                    icon={UsersThree}
                    title="Sin ventas registradas"
                    hint="Aquí se rankean tus operadores por monto y operaciones."
                  />
                ) : (
                  sortedOperators.map((row, idx) => (
                    <div key={row.operator_id ?? row.operator_name} className="flex items-center gap-3">
                      <span className="text-xs text-hint w-5 shrink-0">#{idx + 1}</span>
                      <span className="flex-1 text-sm text-body truncate">{row.operator_name}</span>
                      <span className="text-sm font-semibold text-body shrink-0">
                        {operatorMode === 'amount'
                          ? formatMoney(row.total_revenue ?? 0)
                          : `${row.transactions ?? 0} ventas`}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Ranking */}
              <div className="surface-card p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Ranking de productos</p>
                    <Link href="/stats/top-products" className={WIDGET_LINK_CLASS}>
                      Ver detalle →
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRankingMode('amount')}
                      className={getWidgetToggleClass(rankingMode === 'amount')}
                    >
                      $ Monto
                    </button>
                    <button
                      type="button"
                      onClick={() => setRankingMode('units')}
                      className={getWidgetToggleClass(rankingMode === 'units')}
                    >
                      Unidades
                    </button>
                  </div>
                </div>
                {sortedTopProducts.length === 0 ? (
                  <EmptyWidget
                    icon={ShoppingBag}
                    title="Sin productos vendidos"
                    hint="Aquí aparecen tus productos más vendidos, por monto o unidades."
                  />
                ) : (
                  sortedTopProducts.map((row, idx) => (
                    <div key={row.id} className="flex items-center gap-3">
                      <span className="text-xs text-hint w-5 shrink-0">#{idx + 1}</span>
                      <span className="flex-1 text-sm text-body truncate">{row.name}</span>
                      <span className="text-sm font-semibold text-body shrink-0">
                        {rankingMode === 'amount' ? formatMoney(row.revenue ?? 0) : `${row.units_sold ?? 0} uds`}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Breakdown */}
              <div className="surface-card p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Desglose</p>
                    <Link href="/stats/breakdown" className={WIDGET_LINK_CLASS}>
                      Ver detalle →
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setBreakdownMode('category')}
                      className={getWidgetToggleClass(breakdownMode === 'category')}
                    >
                      Categoría
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode('brand')}
                      className={getWidgetToggleClass(breakdownMode === 'brand')}
                    >
                      Marca
                    </button>
                  </div>
                </div>
                {breakdownData.length === 0 ? (
                  <EmptyWidget
                    icon={Tag}
                    title="Sin datos para el período"
                    hint="Aquí se desglosa tu facturación por categoría o marca."
                  />
                ) : (
                  breakdownData.map(row => (
                    <div key={row.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-body font-medium">{row.label}</span>
                        <span className="text-xs text-subtle">{row.percent.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-alt">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Canal de venta + Impacto de promociones comparten fila (2/4 c/u): suelen
                tener poco contenido y el detalle vive en sus páginas dedicadas. Si no hay
                ventas por catálogo, Impacto ocupa el ancho completo (no media fila vacía). */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Canal de venta: Mostrador vs Pedido online */}
            {showSalesChannel && (
              <div className="surface-card p-6 flex flex-col gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Canal de venta</p>
                    <Link href="/orders" className={WIDGET_LINK_CLASS}>
                      Ver pedidos →
                    </Link>
                  </div>
                  <p className="text-sm text-hint">
                    Cuánto vendiste en el mostrador y cuánto entró por pedidos online en el período.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-edge px-4 py-3">
                    <p className="text-label text-hint">{SALE_SOURCE_LABELS.pos}</p>
                    <p className="text-lg font-semibold text-heading tabular-nums">{formatMoney(salesBySource.pos.revenue)}</p>
                    <p className="text-xs text-hint">
                      {salesBySource.pos.count} venta{salesBySource.pos.count !== 1 ? 's' : ''}
                      <span className="font-medium"> · {posShare.toFixed(0)}%</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                    <p className="text-label text-hint">{SALE_SOURCE_LABELS.catalog}</p>
                    <p className="text-lg font-semibold text-heading tabular-nums">{formatMoney(salesBySource.catalog.revenue)}</p>
                    <p className="text-xs text-hint">
                      {salesBySource.catalog.count} venta{salesBySource.catalog.count !== 1 ? 's' : ''}
                      <span className="font-medium text-primary"> · {catalogShare.toFixed(0)}%</span>
                    </p>
                  </div>
                </div>
                {/* Barra de proporción — anclada al fondo para llenar el card si se estira */}
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex mt-auto" aria-hidden>
                  <div className="h-full bg-subtle/60" style={{ width: `${posShare}%` }} />
                  <div className="h-full bg-primary" style={{ width: `${catalogShare}%` }} />
                </div>
              </div>
            )}

            {/* Impacto de promociones */}
            <div className={cn('surface-card p-6 flex flex-col gap-4', !showSalesChannel && 'xl:col-span-2')}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Impacto de promociones</p>
                    <Link href="/promotions" className={WIDGET_LINK_CLASS}>
                      Ver promociones →
                    </Link>
                  </div>
                  <p className="text-sm text-hint">
                    Cuánto vendiste con promoción aplicada y cuánto descuento resignaste en el período.
                  </p>
                </div>
                {promoTotals && promoTotals.promo_sales_count > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
                    <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                      <p className="text-label text-hint">Ventas con promo</p>
                      <p className="text-sm font-semibold text-heading">
                        {promoTotals.promo_sales_count} de {promoTotals.total_sales_count}
                        <span className="text-xs font-medium text-hint"> · {promoShare.toFixed(0)}%</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                      <p className="text-label text-hint">Facturado con promo</p>
                      <p className="text-sm font-semibold text-heading">{formatMoney(promoTotals.promo_revenue)}</p>
                    </div>
                    <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                      <p className="text-label text-hint">Descuento resignado</p>
                      <p className="text-sm font-semibold text-heading">{formatMoney(promoTotals.promo_discount_total)}</p>
                    </div>
                  </div>
                )}
              </div>

              {promoRows.length === 0 ? (
                <EmptyWidget
                  icon={Tag}
                  title="Sin promociones aplicadas"
                  hint="Aquí se mide cuánto vendiste con promoción y el descuento que resignaste."
                  className="flex-1"
                />
              ) : (
                <div className="space-y-3">
                  <div className="hidden sm:flex items-center gap-3 text-label text-hint">
                    <span className="w-5 shrink-0" />
                    <span className="flex-1">Promoción</span>
                    <span className="w-16 text-right shrink-0">Ventas</span>
                    <span className="w-24 text-right shrink-0">Facturado</span>
                    <span className="w-24 text-right shrink-0">Resignado</span>
                  </div>
                  {promoRows.map((row, idx) => (
                    <div key={row.promotion_id} className="flex items-center gap-3">
                      <span className="text-xs text-hint w-5 shrink-0">#{idx + 1}</span>
                      <span className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-sm text-body truncate">{row.name}</span>
                        <span className="text-[11px] font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5 shrink-0">
                          {promoBadgeLabel(row)}
                        </span>
                        {row.archived && (
                          <span className="text-[11px] text-hint shrink-0">Archivada</span>
                        )}
                      </span>
                      <span className="hidden sm:block text-sm text-body w-16 text-right shrink-0">{row.sales_count}</span>
                      <span className="text-sm font-semibold text-body w-24 text-right shrink-0">{formatMoney(row.revenue)}</span>
                      <span className="hidden sm:block text-sm text-subtle w-24 text-right shrink-0">−{formatMoney(row.discount_total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
