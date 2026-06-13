'use client'

import { useEffect, useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { type DateRangePeriod, getDateRange, resolveDateRange, periodNeedsCustomDates } from '@/lib/date-utils'
import KPICard from '@/components/shared/KPICard'
import Link from 'next/link'
import SalesHistoryTable from '@/components/dashboard/SalesHistoryTable'
import BalanceWidget from '@/components/dashboard/BalanceWidget'
import RecentActivityWidget from '@/components/dashboard/RecentActivityWidget'
import InsightSurfaceAnchor from '@/components/insights/InsightSurfaceAnchor'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { BusinessBalance } from '@/components/expenses/types'
import type { PriceList, SalesHistoryOperator, StatsKpis, StatsEvolution, SalesHeatmapCell } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import type { SupportedCurrencyCode } from '@/lib/constants/currencies'
import OnboardingWizard, { type OnboardingWizardProfile } from '@/components/onboarding/OnboardingWizard'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChartPoint {
  label: string
  value: number          // ingresos del bucket
  transactions: number   // cantidad de ventas del bucket
}

interface DashboardOverview {
  kpis: StatsKpis | null
  balance: BusinessBalance | null
  chart: ChartPoint[]
}

const EMPTY_BALANCE: BusinessBalance = {
  income: 0, expenses: 0, profit: 0, margin: 0, by_category: {}, period_from: '', period_to: '',
}

// "hoy" → barras por hora (8-20h) desde get_sales_heatmap (rango de un día)
function buildHourlyChart(cells: SalesHeatmapCell[]): ChartPoint[] {
  return Array.from({ length: 13 }, (_, i) => {
    const hour = i + 8
    let value = 0
    let transactions = 0
    for (const c of cells) {
      if (c.hour === hour) {
        value += c.net_revenue
        transactions += c.sales_count
      }
    }
    return { label: `${String(hour).padStart(2, '0')}:00`, value, transactions }
  })
}

// resto de períodos → barras por día/semana desde get_stats_evolution
function buildEvolutionChart(evo: StatsEvolution | null): ChartPoint[] {
  return (evo?.data ?? []).map(p => ({ label: p.label, value: p.revenue, transactions: p.count }))
}

export interface RecentActivityRow {
  id: string
  action: string
  entity_type: 'sale' | 'product' | 'category' | 'brand'
  entity_label: string | null
  actor_name: string
  created_at: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

interface ProductRecord {
  id: string
  name: string
  category_id: string | null
  stock: number
  min_stock: number
  is_active: boolean
}

interface Props {
  operators: SalesHistoryOperator[]
  products: ProductRecord[]
  businessId: string | null
  businessName: string
  timezone: string
  // Seed server-side del período inicial ("hoy") para primer paint sin parpadeo
  initialKpis: StatsKpis | null
  initialBalance: BusinessBalance | null
  initialHeatmap: SalesHeatmapCell[]
  onboardingProfile: OnboardingWizardProfile | null
  showOnboardingWizard: boolean
  initialBusinessSettings: Record<string, unknown> | null
  initialCurrency: SupportedCurrencyCode
  operatorId: string | null
  stockWriteAllowed: boolean
  wizardCategories: { id: string; name: string; icon: string }[]
  wizardBrands: InventoryBrand[]
  wizardPriceLists: PriceList[]
  recentActivity: RecentActivityRow[]
}

function computeTrend(
  current: number,
  previous: number,
  trendLabel: string,
  hasPrevRange: boolean
): { percent: number; direction: 'up' | 'down' | 'neutral'; label: string } {
  if (!hasPrevRange || previous === 0) {
    return { percent: 0, direction: 'neutral', label: trendLabel }
  }
  const pct = ((current - previous) / previous) * 100
  return {
    percent: Math.abs(pct),
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
    label: trendLabel,
  }
}

export default function DashboardView({
  operators,
  products,
  businessId,
  businessName,
  timezone,
  initialKpis,
  initialBalance,
  initialHeatmap,
  onboardingProfile,
  showOnboardingWizard,
  initialBusinessSettings,
  initialCurrency,
  operatorId,
  stockWriteAllowed,
  wizardCategories,
  wizardBrands,
  wizardPriceLists,
  recentActivity,
}: Props) {
  const fmt = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])
  const [period, setPeriod] = useState<DateRangePeriod>('hoy')
  const [showHistory, setShowHistory] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [suppressWizardLocal, setSuppressWizardLocal] = useState(false)
  const [mountedAt] = useState(() => Date.now())

  useEffect(() => {
    if (!showOnboardingWizard) {
      setSuppressWizardLocal(false)
    }
  }, [showOnboardingWizard])

  const wizardOpen = showOnboardingWizard && !suppressWizardLocal

  const { setRef, indicator } = usePillIndicator(showHistory ? 'history' : 'overview')

  const periodRange = useMemo(
    () => getDateRange(period, fromDate, toDate),
    [period, fromDate, toDate]
  )

  const resolved = useMemo(
    () => resolveDateRange(period, fromDate || undefined, toDate || undefined, timezone),
    [period, fromDate, toDate, timezone]
  )
  const isInitialRange = period === 'hoy' && !fromDate && !toDate

  const initialOverview = useMemo<DashboardOverview>(
    () => ({ kpis: initialKpis, balance: initialBalance, chart: buildHourlyChart(initialHeatmap) }),
    [initialKpis, initialBalance, initialHeatmap]
  )

  const { data: overviewData } = useQuery<DashboardOverview>({
    queryKey: ['dashboard-overview', businessId, period, resolved.from, resolved.to],
    enabled: !!businessId && !!resolved.from && !!resolved.to,
    initialData: isInitialRange ? initialOverview : undefined,
    initialDataUpdatedAt: isInitialRange ? mountedAt : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const [kpisRes, balanceRes, chartRes] = await Promise.all([
        supabase.rpc('get_stats_kpis', { p_business_id: businessId, p_from: resolved.from, p_to: resolved.to }),
        supabase.rpc('get_business_balance', { p_business_id: businessId, p_from: resolved.from, p_to: resolved.to }),
        period === 'hoy'
          ? supabase.rpc('get_sales_heatmap', { p_business_id: businessId, p_from: resolved.from, p_to: resolved.to })
          : supabase.rpc('get_stats_evolution', { p_business_id: businessId, p_from: resolved.from, p_to: resolved.to }),
      ])
      return {
        kpis: (kpisRes.data as unknown as StatsKpis | null),
        balance: (balanceRes.data as unknown as BusinessBalance | null),
        chart: period === 'hoy'
          ? buildHourlyChart(((chartRes.data as unknown as { data: SalesHeatmapCell[] } | null)?.data) ?? [])
          : buildEvolutionChart(chartRes.data as unknown as StatsEvolution | null),
      }
    },
  })

  const overview = overviewData ?? { kpis: null, balance: null, chart: [] }
  const totalSold = overview.kpis?.total_revenue ?? 0
  const transactions = overview.kpis?.total_sales ?? 0
  const chartData = overview.chart
  const balance = overview.balance ?? EMPTY_BALANCE

  const trendLabel =
    period === 'hoy' ? 'vs ayer'
    : period === 'semana' ? 'vs semana anterior'
    : period === 'mes' ? 'vs mes anterior'
    : ''
  const showTrend = trendLabel !== '' && overview.kpis !== null
  const prevRevenue = overview.kpis?.prev_total_revenue ?? 0
  const revenueDelta = totalSold - prevRevenue
  const revenueDeltaLabel =
    showTrend && prevRevenue !== 0
      ? `${revenueDelta >= 0 ? '+' : '-'}${fmt(Math.abs(revenueDelta))}`
      : undefined
  const kpiTrends = {
    total: { ...computeTrend(totalSold, prevRevenue, trendLabel, showTrend), amount: revenueDeltaLabel },
    transactions: computeTrend(transactions, overview.kpis?.prev_total_sales ?? 0, trendLabel, showTrend),
  }

  const lowStockProducts = useMemo(
    () => products.filter(p => p.is_active && p.stock <= p.min_stock),
    [products]
  )
  const outOfStockCount = useMemo(() => lowStockProducts.filter(p => p.stock <= 0).length, [lowStockProducts])
  const lowStockCount = useMemo(() => lowStockProducts.filter(p => p.stock > 0).length, [lowStockProducts])
  const outOfStock = useMemo(
    () => lowStockProducts.filter(p => p.stock <= 0).sort((a, b) => a.stock - b.stock),
    [lowStockProducts]
  )
  const lowStock = useMemo(
    () => lowStockProducts.filter(p => p.stock > 0).sort((a, b) => a.stock - b.stock),
    [lowStockProducts]
  )
  // Compact peek for the "Stock crítico" KPI: a faithful 2-item miniature of the
  // alerts widget — same priority order (sin stock first, then stock bajo) and the
  // same severity tokens, so glance and detail read as one system.
  const alertPreview = useMemo(() => {
    const rows = [
      ...outOfStock.map(p => ({ id: p.id, name: p.name, tone: 'out' as const })),
      ...lowStock.map(p => ({ id: p.id, name: p.name, tone: 'low' as const })),
    ]
    return { rows: rows.slice(0, 2), remaining: Math.max(0, rows.length - 2) }
  }, [outOfStock, lowStock])

  const historyRange = useMemo(
    () => ({ from: periodRange.from.toISOString(), to: periodRange.to.toISOString() }),
    [periodRange]
  )
  const historyTableKey = `${historyRange.from}:${historyRange.to}`

  const periodLabel =
    period === 'hoy'
      ? 'Hoy'
      : period === 'semana'
      ? 'Esta semana'
      : period === 'mes'
      ? 'Este mes'
      : `${periodRange.from.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} - ${periodRange.to.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`

  const balanceTitle =
    period === 'hoy'
      ? 'Balance de hoy'
      : period === 'semana'
      ? 'Balance de esta semana'
      : period === 'mes'
      ? 'Balance de este mes'
      : 'Balance del período'

  const chartTitle = useMemo(() => {
    switch (period) {
      case 'hoy':
        return 'Ventas por hora — hoy'
      case 'semana':
        return 'Ventas por día — esta semana'
      case 'mes':
        return `Ventas por día — ${periodRange.from.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`
      case 'trimestre':
        return `Ventas por día — ${periodLabel}`
      case 'año':
        return `Ventas por mes — ${periodRange.from.getFullYear()}`
      case 'personalizado':
        return `Ventas por día — ${periodLabel}`
      default:
        return 'Ventas por período'
    }
  }, [period, periodRange, periodLabel])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {wizardOpen && onboardingProfile && businessId && (
        <OnboardingWizard
          profile={onboardingProfile}
          businessId={businessId}
          initialBusinessName={businessName}
          initialBusinessSettings={initialBusinessSettings}
          initialCurrency={initialCurrency}
          operatorId={operatorId}
          stockWriteAllowed={stockWriteAllowed}
          priceLists={wizardPriceLists}
          categories={wizardCategories}
          brands={wizardBrands}
          onFinishedWizard={() => {
            setSuppressWizardLocal(true)
          }}
        />
      )}
      <PageHeader title="Resumen" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DateRangeFilter
              value={period}
              from={fromDate}
              to={toDate}
              onChange={(p, f, t) => {
                setPeriod(p)
                // Limpiar from/to en períodos simples: resolveDateRange prioriza
                // from/to explícitos, así que dejarlos stale rompería hoy/semana/mes.
                setFromDate(periodNeedsCustomDates(p) ? (f ?? '') : '')
                setToDate(periodNeedsCustomDates(p) ? (t ?? '') : '')
              }}
            />

            <div className="flex items-center gap-2">
              {/* Glyph ambiente de IA: sugerencias de canal/globales del dashboard */}
              <InsightSurfaceAnchor surfaces={['dashboard', 'global']} />

              <div className="pill-tabs">
                {indicator && (
                  <span
                    className="pill-tab-indicator"
                    style={{
                      transform: `translateX(${indicator.left}px)`,
                      width: indicator.width,
                    }}
                  />
                )}
                <button
                  type="button"
                  ref={setRef('overview')}
                  onClick={() => setShowHistory(false)}
                  className={`pill-tab${!showHistory ? ' pill-tab-active' : ''}`}
                >
                  Resumen
                </button>
                <button
                  type="button"
                  ref={setRef('history')}
                  onClick={() => setShowHistory(true)}
                  className={`pill-tab${showHistory ? ' pill-tab-active' : ''}`}
                >
                  <span className="lg:hidden">Historial</span>
                  <span className="hidden lg:inline">Historial de ventas</span>
                </button>
              </div>
            </div>
          </div>

          {showHistory ? (
            <SalesHistoryTable
              key={historyTableKey}
              businessId={businessId}
              businessName={businessName}
              operatorId={operatorId}
              from={historyRange.from}
              to={historyRange.to}
              operators={operators}
            />
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-3 gap-4 animate-fade-in">
                <KPICard
                  label="Total vendido"
                  value={fmt(totalSold)}
                  trend={trendLabel ? kpiTrends.total : undefined}
                  sparkline={chartData.map(point => ({ label: point.label, value: point.value }))}
                />
                <KPICard
                  label="Transacciones"
                  value={String(transactions)}
                  trend={trendLabel ? kpiTrends.transactions : undefined}
                  sparkline={chartData.map(point => ({ label: point.label, value: point.transactions }))}
                />
                <KPICard
                  label="Stock crítico"
                  value={String(lowStockProducts.length)}
                  subtitle={`${outOfStockCount} sin stock · ${lowStockCount} stock bajo`}
                >
                  {alertPreview.rows.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {alertPreview.rows.map(p => (
                        <div key={p.id} className="flex items-center gap-2">
                          <span
                            className={cn(
                              'shrink-0 w-1.5 h-1.5 rounded-full',
                              p.tone === 'out' ? 'bg-destructive/70' : 'bg-warning/70'
                            )}
                          />
                          <span className="text-xs text-hint truncate">{p.name}</span>
                        </div>
                      ))}
                      {alertPreview.remaining > 0 && (
                        <p className="text-xs text-hint pl-3.5">
                          +{alertPreview.remaining} más
                        </p>
                      )}
                    </div>
                  )}
                </KPICard>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-stretch">
                <div className="xl:col-span-3 h-full">
                  <BalanceWidget
                    income={balance.income}
                    expenses={balance.expenses}
                    profit={balance.profit}
                    margin={balance.margin}
                    title={balanceTitle}
                    periodLabel={periodLabel}
                    byCategory={balance.by_category}
                  />
                </div>
                <div className="xl:col-span-1 h-full">
                  <RecentActivityWidget entries={recentActivity} />
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="surface-card p-6 animate-fade-in flex flex-col" style={{ animationDelay: '80ms' }}>
                  <p className="font-semibold text-heading mb-4 font-display">
                    {chartTitle}
                  </p>
                  {chartData.every(d => d.value === 0) ? (
                    <p className="text-sm text-hint flex-1 min-h-[16rem] flex items-center justify-center">Sin datos para el período</p>
                  ) : (
                    <div className="flex-1 min-h-[16rem]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <XAxis
                          dataKey="label"
                          height={20}
                          tick={{ fontSize: 10, fill: 'var(--color-hint, #9ca3af)' }}
                          axisLine={false}
                          tickLine={false}
                          interval={chartData.length > 10 ? Math.floor(chartData.length / 6) : 0}
                        />
                        <Tooltip
                          cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null
                            return (
                              <div className="surface-card rounded-lg px-3 py-2 text-xs shadow-sm border border-edge/40">
                                <p className="text-hint mb-0.5">{label}</p>
                                <p className="font-semibold text-heading">
                                  {fmt(Number(payload[0]?.value ?? 0))}
                                </p>
                              </div>
                            )
                          }}
                        />
                        <Bar
                          dataKey="value"
                          fill="var(--color-primary)"
                          fillOpacity={0.8}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={32}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="surface-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="font-semibold text-heading font-display">Alertas de stock</h2>
                      <p className="text-xs text-hint mt-0.5">En tiempo real · no afectado por el filtro</p>
                    </div>
                    <Link href="/inventory" className="text-xs text-primary font-medium hover:underline shrink-0">
                      Ver stock →
                    </Link>
                  </div>
                  {lowStockProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
                      <span className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary">
                        <Check size={18} strokeWidth={2.5} />
                      </span>
                      <p className="text-sm font-medium text-heading">Todo tu stock está en orden</p>
                      <p className="text-xs text-hint">No hay productos por reponer</p>
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto space-y-4 pr-1">
                      {outOfStock.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-destructive mb-2">Sin stock ({outOfStock.length})</p>
                          <div className="space-y-1.5">
                            {outOfStock.map(product => (
                              <Link
                                key={product.id}
                                href={`/inventory?product=${product.id}`}
                                className="block rounded-xl px-4 py-2.5 bg-destructive/10 border border-destructive/20 transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                <p className="text-sm font-medium text-heading">{product.name}</p>
                                <p className="text-xs text-destructive">Sin stock · mín. {product.min_stock}</p>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                      {lowStock.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-warning mb-2">Stock bajo ({lowStock.length})</p>
                          <div className="space-y-0.5">
                            {lowStock.map(product => (
                              <Link
                                key={product.id}
                                href={`/inventory?product=${product.id}`}
                                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-warning/70" />
                                <p className="text-sm font-medium text-heading flex-1 min-w-0 truncate">{product.name}</p>
                                <p className="text-xs text-warning shrink-0">{product.stock} uds · mín. {product.min_stock}</p>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
