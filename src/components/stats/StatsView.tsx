'use client'

import { useState, memo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { buildDateParams, periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import { PAYMENT_LABELS, PAYMENT_COLORS } from '@/lib/payments'
import type {
  StatsKpis, StatsEvolution, StatsBreakdown,
} from '@/lib/types'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

type EvolutionMode = 'revenue' | 'units'
type RankingMode = 'amount' | 'units'
type BreakdownMode = 'category' | 'brand'

interface TopProductRow {
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

export default function StatsView({ kpis, evolution, breakdown, topProducts, period: initialPeriod, from: initialFrom, to: initialTo }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('revenue')
  const [rankingMode, setRankingMode] = useState<RankingMode>('amount')
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('category')

  const totalRevenue = kpis?.total_revenue ?? 0
  const totalUnits = kpis?.total_units ?? 0
  const totalSales = kpis?.total_sales ?? 0
  const avgTicket = kpis?.avg_ticket ?? 0
  const prevRevenue = kpis?.prev_total_revenue ?? 0
  const prevUnits = kpis?.prev_total_units ?? 0
  const prevAvgTicket = (kpis?.prev_total_sales ?? 0) > 0
    ? (kpis?.prev_total_revenue ?? 0) / (kpis?.prev_total_sales ?? 1)
    : 0

  const peakDay = kpis?.peak_day
    ? new Date(kpis.peak_day + 'T12:00:00').toLocaleDateString('es-AR')
    : '-'

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
        <div className="px-6 pt-4 pb-6 space-y-5">
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
                <span className="h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400">$</span>
                <DeltaBadge current={totalRevenue} previous={prevRevenue} />
              </div>
              <div>
                <p className="text-label text-hint mb-1">Ingresos totales</p>
                <p className="text-2xl font-bold text-heading leading-none">${totalRevenue.toLocaleString('es-AR')}</p>
              </div>
            </div>
            <div className="surface-card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <span className="h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">U</span>
                <DeltaBadge current={totalUnits} previous={prevUnits} />
              </div>
              <div>
                <p className="text-label text-hint mb-1">Unidades vendidas</p>
                <p className="text-2xl font-bold text-heading leading-none">{totalUnits}</p>
              </div>
            </div>
            <div className="surface-card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <span className="h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400">T</span>
                <DeltaBadge current={avgTicket} previous={prevAvgTicket} />
              </div>
              <div>
                <p className="text-label text-hint mb-1">Ticket promedio</p>
                <p className="text-2xl font-bold text-heading leading-none">${avgTicket.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
              </div>
            </div>
            <div className="surface-card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <span className="h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400">D</span>
              </div>
              <div>
                <p className="text-label text-hint mb-1">Día pico</p>
                <p className="text-2xl font-bold text-heading leading-none">{peakDay}</p>
              </div>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
            {/* Evolution chart */}
            <div className="surface-card p-6 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-heading">Evolución</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setEvolutionMode('revenue')}
                    className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${evolutionMode === 'revenue' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'}`}
                  >
                    $ Ingresos
                  </button>
                  <button
                    onClick={() => setEvolutionMode('units')}
                    className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${evolutionMode === 'units' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'}`}
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
                      <svg width="16" height="3" viewBox="0 0 16 3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke="#1C4A3B" strokeWidth="2" /></svg>
                      Período actual
                    </span>
                    <span className="flex items-center gap-1.5">
                      <svg width="16" height="3" viewBox="0 0 16 3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke="#9ca3af" strokeWidth="2" strokeDasharray="4 4" /></svg>
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
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        interval={evolutionData.length > 14 ? Math.floor(evolutionData.length / 7) : 0}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        tickFormatter={v =>
                          evolutionMode === 'revenue'
                            ? v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
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
                              ? `$${v.toLocaleString('es-AR')}`
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
                        stroke="#1C4A3B"
                        strokeWidth={2}
                        dot={false}
                        name="Actual"
                      />
                      <Line
                        type="monotone"
                        dataKey={evolutionMode === 'revenue' ? 'previousRevenue' : 'previousUnits'}
                        stroke="#9ca3af"
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
                <p className="font-semibold text-heading">Métodos de pago</p>
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
                      <span className="text-body font-medium">{PAYMENT_LABELS[row.method as keyof typeof PAYMENT_LABELS] ?? row.method}</span>
                      <span className="text-subtle text-xs">{row.percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-alt">
                      <div className={`h-2 rounded-full ${PAYMENT_COLORS[row.method as keyof typeof PAYMENT_COLORS] ?? 'bg-hint'}`} style={{ width: `${row.percent}%` }} />
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
                  <p className="font-semibold text-heading">Ranking de productos</p>
                  <Link href="/stats/top-products" className="text-xs text-primary font-medium hover:underline">
                    Ver más →
                  </Link>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setRankingMode('amount')}
                    className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${rankingMode === 'amount' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'}`}
                  >
                    $ Monto
                  </button>
                  <button
                    onClick={() => setRankingMode('units')}
                    className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${rankingMode === 'units' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'}`}
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
                      {rankingMode === 'amount' ? `$${(row.revenue ?? 0).toLocaleString('es-AR')}` : `${row.units_sold ?? 0} uds`}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Breakdown */}
            <div className="surface-card p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-heading">Breakdown</p>
                  <Link href="/stats/breakdown" className="text-xs text-primary font-medium hover:underline">
                    Ver más →
                  </Link>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setBreakdownMode('category')}
                    className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${breakdownMode === 'category' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'}`}
                  >
                    Categoría
                  </button>
                  <button
                    onClick={() => setBreakdownMode('brand')}
                    className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${breakdownMode === 'brand' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'}`}
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
          {/* Day of week distribution */}
          <div className="surface-card p-6 space-y-3">
            <p className="font-semibold text-heading">Ventas por día de la semana</p>
            {dayOfWeekData.length === 0 || totalSales === 0 ? (
              <p className="text-sm text-hint h-32 flex items-center justify-center">Sin datos para el período</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={dayOfWeekData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                    width={50}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(28, 74, 59, 0.05)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <div className="surface-elevated rounded-xl p-2.5 text-xs shadow-sm">
                          <p className="font-semibold text-heading">{label}</p>
                          <p className="text-body">${Number(payload[0]?.value ?? 0).toLocaleString('es-AR')}</p>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="revenue" fill="#1C4A3B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
