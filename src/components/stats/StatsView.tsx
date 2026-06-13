'use client'

import { useMemo, useState, memo } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { TrendingDown, TrendingUp, DollarSign, ShoppingBag, Receipt, Hash, FileText, PackageX, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import PageHeader from '@/components/shared/PageHeader'
import InsightSurfaceAnchor from '@/components/insights/InsightSurfaceAnchor'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import { buildDateParams, periodNeedsCustomDates, resolveDateRange, type DateRangePeriod } from '@/lib/date-utils'
import { isPaymentMethod, normalizePayment, PAYMENT_BAR_COLORS } from '@/lib/payments'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type {
  DailySnapshotRow, OperatorSalesStatsRow, StatsKpis, StatsEvolution, StatsBreakdown, SalesHeatmapCell, DeadStockSummary, PromoImpact,
} from '@/lib/types'
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
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
          : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
      }`}
    >
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
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
      const [kpisResult, evolutionResult, breakdownResult, topProductsResult, operatorsResult, dailySnapshotsResult, heatmapResult, promoImpactResult] = await Promise.all([
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
  const prevAvgTicket = (kpis?.prev_total_sales ?? 0) > 0
    ? (kpis?.prev_total_revenue ?? 0) / (kpis?.prev_total_sales ?? 1)
    : 0

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
        <div className="px-5 pt-4 pb-6 space-y-5">
          {/* Period filter */}
          <div className="flex items-center gap-4">
            <DateRangeFilter
              value={period}
              from={from}
              to={to}
              onChange={handlePeriodChange}
            />
            {isFetching && <span className="text-xs text-hint shrink-0">Actualizando...</span>}
            <Link
              href={`/stats/report?period=${period}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
              className="ml-auto inline-flex items-center gap-1.5 pill-tab border border-edge text-body hover:border-primary/30 hover:text-primary transition-[transform,color,border-color] duration-150 ease-[var(--ease-out)] shrink-0"
            >
              <FileText size={15} />
              Reporte PDF
            </Link>
          </div>

          {/* Stock inmovilizado — independiente del período (estado "al día de hoy") */}
          {deadStockSummary && (
            <Link
              href="/stats/inventory-health"
              className="surface-card flex items-center gap-4 p-4 hover:border-primary/30 transition-colors group"
            >
              <span
                className={cn(
                  'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                  deadStockSummary.products_flagged > 0
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-muted text-body'
                )}
              >
                <PackageX size={18} />
              </span>
              <div className="min-w-0 flex-1">
                {deadStockSummary.products_flagged > 0 ? (
                  <>
                    <p className="text-sm font-semibold text-heading">
                      {formatMoney(deadStockSummary.total_frozen_capital)} inmovilizados
                    </p>
                    <p className="text-xs text-hint">
                      {deadStockSummary.products_flagged} {deadStockSummary.products_flagged === 1 ? 'producto sin rotación' : 'productos sin rotación'}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-heading">Tu inventario rota bien</p>
                    <p className="text-xs text-hint">Sin stock inmovilizado detectado</p>
                  </>
                )}
              </div>
              <ChevronRight size={18} className="text-hint group-hover:text-primary transition-colors shrink-0" />
            </Link>
          )}

          <div className={`space-y-5 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 bg-muted text-body">
                    <DollarSign size={16} />
                  </span>
                  <DeltaBadge current={totalRevenue} previous={prevRevenue} />
                </div>
                <div>
                  <p className="text-label text-hint mb-1">Ingresos totales</p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none" value={formatMoney(totalRevenue)} />
                </div>
              </div>
              <div className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 bg-muted text-body">
                    <ShoppingBag size={16} />
                  </span>
                  <DeltaBadge current={totalUnits} previous={prevUnits} />
                </div>
                <div>
                  <p className="text-label text-hint mb-1">Unidades vendidas</p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none" value={String(totalUnits)} />
                </div>
              </div>
              <div className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 bg-muted text-body">
                    <Receipt size={16} />
                  </span>
                  <DeltaBadge current={avgTicket} previous={prevAvgTicket} />
                </div>
                <div>
                  <p className="text-label text-hint mb-1">Ticket promedio</p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none" value={formatMoney(avgTicket)} />
                </div>
              </div>
              <div className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 bg-muted text-body">
                    <Hash size={16} />
                  </span>
                </div>
                <div>
                  <p className="text-label text-hint mb-1">Total transacciones</p>
                  <PopNumber className="text-2xl font-bold text-heading leading-none" value={totalSales.toLocaleString('es-AR')} />
                </div>
              </div>
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
                  <p className="text-sm text-hint h-48 flex items-center justify-center">Sin datos</p>
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
                  <Link href="/stats/payment-methods" className="text-xs text-primary font-medium hover:underline whitespace-nowrap">
                    Ver más →
                  </Link>
                </div>
                {paymentBreakdown.length === 0 ? (
                  <p className="text-sm text-hint">Sin datos</p>
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
                      className="text-xs text-primary font-medium hover:underline whitespace-nowrap"
                    >
                      Ver detalle →
                    </Link>
                  </div>
                  <p className="text-sm text-hint">
                    Basado en snapshots diarios del negocio. Esta capa servirá también como base para insights automáticos.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
                  <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                    <p className="text-[11px] uppercase tracking-wide text-hint">Ingresos netos</p>
                    <p className="text-sm font-semibold text-heading">{formatMoney(snapshotTotals.netRevenue)}</p>
                  </div>
                  <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                    <p className="text-[11px] uppercase tracking-wide text-hint">Gastos</p>
                    <p className="text-sm font-semibold text-heading">{formatMoney(snapshotTotals.expenses)}</p>
                  </div>
                  <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                    <p className="text-[11px] uppercase tracking-wide text-hint">Mejor día</p>
                    <p className="text-sm font-semibold text-heading">
                      {bestRevenueDay ? `${bestRevenueDay.label} · ${formatMoney(bestRevenueDay.netRevenue)}` : 'Sin datos'}
                    </p>
                  </div>
                </div>
              </div>

              {snapshotTrendData.length === 0 ? (
                <p className="text-sm text-hint h-48 flex items-center justify-center">Sin snapshots para el período</p>
              ) : (
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
                      stroke="#C66A2B"
                      strokeWidth={2}
                      dot={false}
                      name="Gastos"
                    />
                  </LineChart>
                </ResponsiveContainer>
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
                      className="text-xs text-primary font-medium hover:underline whitespace-nowrap"
                    >
                      Ver detalle →
                    </Link>
                  </div>
                  <p className="text-sm text-hint">
                    Concentración de ventas en hora local. Útil para detectar horas pico y bajones.
                  </p>
                </div>
                {heatmapCells.length === 0 ? (
                  <p className="text-sm text-hint h-32 flex items-center justify-center">
                    Sin ventas en el período
                  </p>
                ) : (
                  <SalesHeatmap cells={heatmapCells} metric="sales_count" compact />
                )}
              </div>

              <div className="surface-card p-6 space-y-4">
                <p className="font-semibold text-heading font-display">Distribución por día</p>
                {dayOfWeekData.length === 0 || totalSales === 0 ? (
                  <p className="text-sm text-hint h-24 flex items-center justify-center">Sin datos para el período</p>
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
                    <Link href="/stats/operators" className="text-xs text-primary font-medium hover:underline whitespace-nowrap">
                      Ver más →
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
                  <p className="text-sm text-hint">Sin datos</p>
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
                    <Link href="/stats/top-products" className="text-xs text-primary font-medium hover:underline whitespace-nowrap">
                      Ver más →
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
                  <p className="text-sm text-hint">Sin datos</p>
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
                    <Link href="/stats/breakdown" className="text-xs text-primary font-medium hover:underline whitespace-nowrap">
                      Ver más →
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
                  <p className="text-sm text-hint">Sin datos</p>
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

            {/* Impacto de promociones */}
            <div className="surface-card p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-heading font-display">Impacto de promociones</p>
                    <Link href="/promotions" className="text-xs text-primary font-medium hover:underline whitespace-nowrap">
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
                      <p className="text-[11px] uppercase tracking-wide text-hint">Ventas con promo</p>
                      <p className="text-sm font-semibold text-heading">
                        {promoTotals.promo_sales_count} de {promoTotals.total_sales_count}
                        <span className="text-xs font-medium text-hint"> · {promoShare.toFixed(0)}%</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                      <p className="text-[11px] uppercase tracking-wide text-hint">Facturado con promo</p>
                      <p className="text-sm font-semibold text-heading">{formatMoney(promoTotals.promo_revenue)}</p>
                    </div>
                    <div className="rounded-xl border border-edge px-3 py-2 min-w-[132px]">
                      <p className="text-[11px] uppercase tracking-wide text-hint">Descuento resignado</p>
                      <p className="text-sm font-semibold text-heading">{formatMoney(promoTotals.promo_discount_total)}</p>
                    </div>
                  </div>
                )}
              </div>

              {promoRows.length === 0 ? (
                <p className="text-sm text-hint">Sin ventas con promoción en este período.</p>
              ) : (
                <div className="space-y-3">
                  <div className="hidden sm:flex items-center gap-3 text-[11px] uppercase tracking-wide text-hint">
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
  )
}
