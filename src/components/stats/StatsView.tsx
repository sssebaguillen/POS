'use client'

import { useState, memo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TrendingDown, TrendingUp, DollarSign, ShoppingBag, Receipt, Hash } from 'lucide-react'
import Link from 'next/link'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { buildDateParams, periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import { PAYMENT_COLORS, isPaymentMethod, normalizePayment } from '@/lib/payments'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type {
  OperatorSalesStatsRow, StatsKpis, StatsEvolution, StatsBreakdown,
} from '@/lib/types'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

type EvolutionMode = 'revenue' | 'units'
type RankingMode = 'amount' | 'units'
type BreakdownMode = 'category' | 'brand'
type OperatorMode = 'amount' | 'transactions'

function getWidgetToggleClass(isActive: boolean): string {
  return cn(
    'pill-tab border border-transparent transition-colors',
    isActive && 'bg-primary/10 text-primary border-primary/20 dark:bg-primary/15 dark:border-primary/30'
  )
}

export interface TopProductRow {
  id: string
  name: string
  units_sold: number
  revenue: number
}

interface Props {
  kpis: StatsKpis | null
  evolution: StatsEvolution | null
  breakdown: StatsBreakdown | null
  topProducts: TopProductRow[]
  operators: OperatorSalesStatsRow[]
  period: string
  from?: string
  to?: string
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

export default function StatsView({ kpis, evolution, breakdown, topProducts, operators, period: initialPeriod, from: initialFrom, to: initialTo }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('revenue')
  const [rankingMode, setRankingMode] = useState<RankingMode>('amount')
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('category')
  const [operatorMode, setOperatorMode] = useState<OperatorMode>('amount')

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
      ? (breakdown?.by_category ?? []).map(r => ({ label: r.category_name || 'Sin categoria', value: r.revenue ?? 0 }))
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

  function handlePeriodChange(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    const resolvedFrom = periodNeedsCustomDates(nextPeriod) ? nextFrom : undefined
    const resolvedTo = periodNeedsCustomDates(nextPeriod) ? nextTo : undefined
    const query = buildDateParams(nextPeriod, resolvedFrom, resolvedTo)
    router.push(`${pathname}?${query}`)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Estadísticas" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-5">
          {/* Period filter */}
          <DateRangeFilter
            value={initialPeriod as DateRangePeriod}
            from={initialFrom}
            to={initialTo}
            onChange={handlePeriodChange}
          />

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
                <p className="text-2xl font-bold text-heading leading-none">{formatMoney(totalRevenue)}</p>
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
                <p className="text-2xl font-bold text-heading leading-none">{totalUnits}</p>
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
                <p className="text-2xl font-bold text-heading leading-none">{formatMoney(avgTicket)}</p>
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
                <p className="text-2xl font-bold text-heading leading-none">{totalSales.toLocaleString('es-AR')}</p>
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
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
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
                <Link href="/stats/payment-methods" className="text-xs text-primary font-medium hover:underline">
                  Ver más →
                </Link>
              </div>
              {paymentBreakdown.length === 0 ? (
                <p className="text-sm text-hint">Sin datos</p>
              ) : (
                paymentBreakdown.map(row => (
                  <div key={row.method} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-body font-medium">{normalizePayment(row.method)}</span>
                      <span className="text-subtle text-xs">{row.percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-alt">
                      <div className={`h-2 rounded-full ${isPaymentMethod(row.method) ? PAYMENT_COLORS[row.method] : 'bg-hint'}`} style={{ width: `${row.percent}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Ranking */}
            <div className="surface-card p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-heading font-display">Ranking de productos</p>
                  <Link href="/stats/top-products" className="text-xs text-primary font-medium hover:underline">
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
                  <Link href="/stats/breakdown" className="text-xs text-primary font-medium hover:underline">
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
          {/* Operators + Day of week */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Operator sales widget */}
            <div className="surface-card p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-heading font-display">Ventas por operador</p>
                  <Link href="/stats/operators" className="text-xs text-primary font-medium hover:underline">
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

            {/* Day of week distribution */}
            <div className="surface-card px-5 pt-4 pb-3 space-y-2">
            <p className="text-xs font-medium text-hint uppercase tracking-wide">Distribución por día</p>
            {dayOfWeekData.length === 0 || totalSales === 0 ? (
              <p className="text-sm text-hint h-24 flex items-center justify-center">Sin datos para el período</p>
            ) : (
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={dayOfWeekData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
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
        </div>
      </div>
    </div>
  )
}
