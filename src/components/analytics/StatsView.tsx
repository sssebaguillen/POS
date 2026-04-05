'use client'

import { useMemo, useState, memo } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter, { type DateRangePeriod } from '@/components/shared/DateRangeFilter'
import {
  endOfDay, isCompletedSale, startOfDay, startOfWeek,
  getPreviousPeriodRange, getDayLabel,
} from '@/components/analytics/utils'
import { PAYMENT_LABELS, PAYMENT_COLORS } from '@/lib/payments'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

type EvolutionMode = 'revenue' | 'units'
type RankingMode = 'amount' | 'units'
type BreakdownMode = 'category' | 'brand'

interface SaleRecord {
  id: string
  total: number
  created_at: string
  status: string | null
}

interface PaymentRecord {
  sale_id: string
  method: string
  amount: number
}

interface SaleItemRecord {
  sale_id: string
  product_id: string | null
  quantity: number
  total: number
}

interface ProductRecord {
  id: string
  name: string
  category_id: string | null
  brand_id: string | null
  brand: { id: string; name: string } | null
}

interface CategoryRecord {
  id: string
  name: string
}

interface Props {
  sales: SaleRecord[]
  payments: PaymentRecord[]
  saleItems: SaleItemRecord[]
  products: ProductRecord[]
  categories: CategoryRecord[]
}

interface EvolutionPoint {
  label: string
  currentRevenue: number
  currentUnits: number
  previousRevenue: number
  previousUnits: number
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

export default function StatsView({ sales, payments, saleItems, products, categories }: Props) {
  const [period, setPeriod] = useState<DateRangePeriod>('hoy')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('revenue')
  const [rankingMode, setRankingMode] = useState<RankingMode>('amount')
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('category')

  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const categoriesById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  const range = useMemo(() => {
    const now = new Date()
    if (period === 'hoy') return { from: startOfDay(now), to: endOfDay(now) }
    if (period === 'semana') return { from: startOfWeek(now), to: endOfDay(now) }
    if (period === 'mes') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
    if (period === 'trimestre' && fromDate && toDate) {
      return { from: startOfDay(new Date(fromDate)), to: endOfDay(new Date(toDate)) }
    }
    if (period === 'año' && fromDate && toDate) {
      return { from: startOfDay(new Date(fromDate)), to: endOfDay(new Date(toDate)) }
    }
    if (fromDate && toDate) {
      return { from: startOfDay(new Date(fromDate)), to: endOfDay(new Date(toDate)) }
    }

    const from = new Date(now)
    from.setDate(from.getDate() - 30)
    return { from: startOfDay(from), to: endOfDay(now) }
  }, [period, fromDate, toDate])

  const filteredSales = useMemo(
    () => sales.filter(sale => {
      const createdAt = new Date(sale.created_at)
      return createdAt >= range.from && createdAt <= range.to && isCompletedSale(sale.status)
    }),
    [sales, range]
  )

  const filteredSaleIds = useMemo(() => new Set(filteredSales.map(s => s.id)), [filteredSales])

  const saleCreatedAtById = useMemo(
    () => new Map(filteredSales.map(sale => [sale.id, sale.created_at])),
    [filteredSales]
  )

  const filteredItems = useMemo(() => {
    return saleItems.filter(item => filteredSaleIds.has(item.sale_id))
  }, [saleItems, filteredSaleIds])

  const previousRange = useMemo(() => getPreviousPeriodRange(period, range), [period, range])

  const previousSales = useMemo(
    () => sales.filter(s => {
      const d = new Date(s.created_at)
      return d >= previousRange.from && d <= previousRange.to && isCompletedSale(s.status)
    }),
    [sales, previousRange]
  )
  const previousSaleIds = useMemo(() => new Set(previousSales.map(s => s.id)), [previousSales])
  const previousSaleCreatedAtById = useMemo(
    () => new Map(previousSales.map(s => [s.id, s.created_at])),
    [previousSales]
  )
  const previousItems = useMemo(
    () => saleItems.filter(i => previousSaleIds.has(i.sale_id)),
    [saleItems, previousSaleIds]
  )

  const totalRevenue = useMemo(
    () => filteredSales.reduce((acc, sale) => acc + Number(sale.total), 0),
    [filteredSales]
  )
  const totalUnits = useMemo(
    () => filteredItems.reduce((acc, item) => acc + Number(item.quantity), 0),
    [filteredItems]
  )
  const avgTicket = useMemo(
    () => filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0,
    [filteredSales, totalRevenue]
  )

  const prevRevenue = useMemo(
    () => previousSales.reduce((acc, s) => acc + Number(s.total), 0),
    [previousSales]
  )
  const prevUnits = useMemo(
    () => previousItems.reduce((acc, i) => acc + Number(i.quantity), 0),
    [previousItems]
  )
  const prevAvgTicket = useMemo(
    () => previousSales.length > 0 ? prevRevenue / previousSales.length : 0,
    [previousSales, prevRevenue]
  )

  const peakDay = useMemo(() => {
    const byDay: Record<string, number> = {}
    filteredSales.forEach(sale => {
      const key = new Date(sale.created_at).toLocaleDateString('es-AR')
      byDay[key] = (byDay[key] ?? 0) + Number(sale.total)
    })
    const winner = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]
    return winner ? winner[0] : '-'
  }, [filteredSales])

  const evolutionData = useMemo((): EvolutionPoint[] => {
    const currentByDay: Record<string, { revenue: number; units: number }> = {}
    filteredSales.forEach(s => {
      const k = s.created_at.slice(0, 10)
      if (!currentByDay[k]) currentByDay[k] = { revenue: 0, units: 0 }
      currentByDay[k].revenue += Number(s.total)
    })
    filteredItems.forEach(item => {
      const ca = saleCreatedAtById.get(item.sale_id)
      if (!ca) return
      const k = ca.slice(0, 10)
      if (!currentByDay[k]) currentByDay[k] = { revenue: 0, units: 0 }
      currentByDay[k].units += Number(item.quantity)
    })

    const previousByDay: Record<string, { revenue: number; units: number }> = {}
    previousSales.forEach(s => {
      const k = s.created_at.slice(0, 10)
      if (!previousByDay[k]) previousByDay[k] = { revenue: 0, units: 0 }
      previousByDay[k].revenue += Number(s.total)
    })
    previousItems.forEach(item => {
      const ca = previousSaleCreatedAtById.get(item.sale_id)
      if (!ca) return
      const k = ca.slice(0, 10)
      if (!previousByDay[k]) previousByDay[k] = { revenue: 0, units: 0 }
      previousByDay[k].units += Number(item.quantity)
    })

    const points: EvolutionPoint[] = []
    const dayMs = 24 * 60 * 60 * 1000
    const currentCursor = new Date(range.from)
    currentCursor.setHours(0, 0, 0, 0)
    const rangeEndDay = new Date(range.to)
    rangeEndDay.setHours(0, 0, 0, 0)
    const prevCursor = new Date(previousRange.from)
    prevCursor.setHours(0, 0, 0, 0)

    while (currentCursor <= rangeEndDay) {
      const ck = currentCursor.toISOString().slice(0, 10)
      const pk = prevCursor.toISOString().slice(0, 10)
      points.push({
        label: currentCursor.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
        currentRevenue: currentByDay[ck]?.revenue ?? 0,
        currentUnits: currentByDay[ck]?.units ?? 0,
        previousRevenue: previousByDay[pk]?.revenue ?? 0,
        previousUnits: previousByDay[pk]?.units ?? 0,
      })
      currentCursor.setTime(currentCursor.getTime() + dayMs)
      prevCursor.setTime(prevCursor.getTime() + dayMs)
    }
    return points
  }, [filteredSales, filteredItems, saleCreatedAtById, previousSales, previousItems, previousSaleCreatedAtById, range, previousRange])

  const dayOfWeekData = useMemo(() => {
    const byDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
    filteredSales.forEach(s => {
      byDay[new Date(s.created_at).getDay()] += Number(s.total)
    })
    return [1, 2, 3, 4, 5, 6, 0].map(idx => ({ day: getDayLabel(idx), revenue: byDay[idx] }))
  }, [filteredSales])

  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {}
    payments.forEach(payment => {
      if (!filteredSaleIds.has(payment.sale_id)) return
      map[payment.method] = (map[payment.method] ?? 0) + Number(payment.amount)
    })

    const total = Object.values(map).reduce((acc, value) => acc + value, 0)
    return Object.entries(map)
      .map(([method, amount]) => ({ method, amount, percent: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
  }, [payments, filteredSaleIds])

  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; amount: number; units: number }> = {}
    filteredItems.forEach(item => {
      if (!item.product_id) return
      const product = productsById.get(item.product_id)
      const name = product?.name ?? 'Producto eliminado'
      if (!map[name]) map[name] = { name, amount: 0, units: 0 }
      map[name].amount += Number(item.total)
      map[name].units += Number(item.quantity)
    })

    return Object.values(map)
      .sort((a, b) => rankingMode === 'amount' ? b.amount - a.amount : b.units - a.units)
      .slice(0, 8)
  }, [filteredItems, productsById, rankingMode])

  const breakdown = useMemo(() => {
    if (breakdownMode === 'category') {
      const map: Record<string, number> = {}
      filteredItems.forEach(item => {
        if (!item.product_id) return
        const product = productsById.get(item.product_id)
        if (!product) return
        const key = categoriesById.get(product.category_id ?? '') ?? 'Sin categoría'
        map[key] = (map[key] ?? 0) + Number(item.total)
      })
      const total = Object.values(map).reduce((acc, value) => acc + value, 0)
      return Object.entries(map)
        .map(([label, value]) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
    }

    const byBrandId: Record<string, { label: string; value: number }> = {}
    filteredItems.forEach(item => {
      if (!item.product_id) return
      const product = productsById.get(item.product_id)
      if (!product) return
      const brandKey = product.brand_id ?? 'no-brand'
      const brandLabel = product.brand?.name ?? 'Sin marca'
      if (!byBrandId[brandKey]) byBrandId[brandKey] = { label: brandLabel, value: 0 }
      byBrandId[brandKey].value += Number(item.total)
    })
    const total = Object.values(byBrandId).reduce((acc, { value }) => acc + value, 0)
    return Object.values(byBrandId)
      .map(({ label, value }) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [filteredItems, productsById, categoriesById, breakdownMode])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Estadísticas" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          {/* Period filter */}
          <DateRangeFilter
            value={period}
            from={fromDate}
            to={toDate}
            onChange={(p, f, t) => {
              setPeriod(p)
              if (f) setFromDate(f)
              if (t) setToDate(t)
            }}
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
                <Link href="/stats/metodos-pago" className="text-xs text-primary font-medium hover:underline">
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
              {topProducts.length === 0 ? (
                <p className="text-sm text-hint">Sin datos</p>
              ) : (
                topProducts.map((row, idx) => (
                  <div key={row.name + idx} className="flex items-center gap-3">
                    <span className="text-xs text-hint w-5 shrink-0">#{idx + 1}</span>
                    <span className="flex-1 text-sm text-body truncate">{row.name}</span>
                    <span className="text-sm font-semibold text-body shrink-0">
                      {rankingMode === 'amount' ? `$${row.amount.toLocaleString('es-AR')}` : `${row.units} uds`}
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
              {breakdown.length === 0 ? (
                <p className="text-sm text-hint">Sin datos</p>
              ) : (
                breakdown.map(row => (
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
            {filteredSales.length === 0 ? (
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
