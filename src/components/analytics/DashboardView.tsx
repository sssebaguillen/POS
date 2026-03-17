'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/shared/PageHeader'
import KPICard from '@/components/shared/KPICard'
import Link from 'next/link'
import { endOfDay, isCompletedSale, startOfDay, startOfWeek } from '@/components/analytics/utils'
import { normalizePayment } from '@/lib/payments'
import SalesHistoryTable from '@/components/dashboard/SalesHistoryTable'

type Period = 'today' | 'week' | 'month' | 'custom' | 'history'

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
  created_at: string
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
  stock: number
  min_stock: number
  is_active: boolean
}

interface Props {
  sales: SaleRecord[]
  payments: PaymentRecord[]
  saleItems: SaleItemRecord[]
  products: ProductRecord[]
  businessId: string | null
}

export default function DashboardView({ sales, payments, saleItems, products, businessId }: Props) {
  const [period, setPeriod] = useState<Period>('today')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const paymentsBySaleId = useMemo(() => {
    const map = new Map<string, string>()
    const ordered = [...payments].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    ordered.forEach(p => { if (!map.has(p.sale_id)) map.set(p.sale_id, p.method) })
    return map
  }, [payments])

  const periodRange = useMemo(() => {
    const now = new Date()
    if (period === 'today') return { from: startOfDay(now), to: endOfDay(now) }
    if (period === 'week') return { from: startOfWeek(now), to: endOfDay(now) }
    if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
    if ((period === 'custom' || period === 'history') && fromDate && toDate) {
      return { from: startOfDay(new Date(fromDate)), to: endOfDay(new Date(toDate)) }
    }
    const defaultFrom = new Date(now)
    defaultFrom.setDate(defaultFrom.getDate() - 30)
    return { from: startOfDay(defaultFrom), to: endOfDay(now) }
  }, [period, fromDate, toDate])

  const filteredSales = useMemo(() =>
    sales.filter(s => {
      const d = new Date(s.created_at)
      return d >= periodRange.from && d <= periodRange.to
    }),
    [sales, periodRange])

  const completedSales = useMemo(
    () => filteredSales.filter(sale => isCompletedSale(sale.status)),
    [filteredSales]
  )

  const filteredSaleIds = useMemo(() => new Set(completedSales.map(s => s.id)), [completedSales])
  const filteredItems = useMemo(() => saleItems.filter(i => filteredSaleIds.has(i.sale_id)), [saleItems, filteredSaleIds])

  const totalSold = completedSales.reduce((acc, s) => acc + Number(s.total), 0)
  const transactions = completedSales.length
  const lowStockProducts = products.filter(p => p.is_active && p.stock <= p.min_stock)
  const outOfStockCount = lowStockProducts.filter(p => p.stock <= 0).length
  const lowStockCount = lowStockProducts.filter(p => p.stock > 0).length

  const mostUsedPayment = useMemo(() => {
    const counts: Record<string, number> = {}
    completedSales.forEach(s => {
      const m = paymentsBySaleId.get(s.id) ?? 'sin dato'
      counts[m] = (counts[m] ?? 0) + 1
    })
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return winner ? { method: winner[0], count: winner[1] } : null
  }, [completedSales, paymentsBySaleId])

  // Vertical bar chart data
  const chartData = useMemo(() => {
    if (period === 'today') {
      return Array.from({ length: 13 }, (_, i) => {
        const hour = i + 8
        const total = completedSales
          .filter(s => new Date(s.created_at).getHours() === hour)
          .reduce((acc, s) => acc + Number(s.total), 0)
        return { label: `${hour.toString().padStart(2, '0')}:00`, value: total }
      })
    }
    const groups = new Map<string, number>()
    completedSales.forEach(s => {
      const dayKey = s.created_at.slice(0, 10)
      groups.set(dayKey, (groups.get(dayKey) ?? 0) + Number(s.total))
    })
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, value]) => ({
        label: new Date(`${dayKey}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
        value,
      }))
  }, [completedSales, period])

  const maxChartValue = Math.max(...chartData.map(d => d.value), 1)

  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; amount: number; icon: string }> = {}
    filteredItems.forEach(item => {
      if (!item.product_id) return
      const product = productsById.get(item.product_id)
      if (!map[item.product_id]) {
        map[item.product_id] = { name: product?.name ?? 'Eliminado', qty: 0, amount: 0, icon: 'CAT' }
      }
      map[item.product_id].qty += Number(item.quantity)
      map[item.product_id].amount += Number(item.total)
    })
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5)
  }, [filteredItems, productsById])

  const outOfStock = lowStockProducts.filter(p => p.stock <= 0).sort((a, b) => a.stock - b.stock)
  const lowStock = lowStockProducts.filter(p => p.stock > 0).sort((a, b) => a.stock - b.stock)

  // Trend: previous period range for comparison
  const prevPeriodRange = useMemo(() => {
    const now = new Date()
    if (period === 'today') {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) }
    }
    if (period === 'week') {
      const prevWeekStart = startOfWeek(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
      const prevWeekEnd = new Date(startOfWeek(now).getTime() - 1)
      return { from: prevWeekStart, to: endOfDay(prevWeekEnd) }
    }
    if (period === 'month') {
      const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: startOfDay(firstOfPrevMonth), to: endOfDay(lastOfPrevMonth) }
    }
    return null
  }, [period])

  const prevCompletedSales = useMemo(() => {
    if (!prevPeriodRange) return []
    return sales.filter(s => {
      const d = new Date(s.created_at)
      return d >= prevPeriodRange.from && d <= prevPeriodRange.to && isCompletedSale(s.status)
    })
  }, [sales, prevPeriodRange])

  function computeTrend(
    current: number,
    previous: number,
    trendLabel: string
  ): { percent: number; direction: 'up' | 'down' | 'neutral'; label: string } {
    if (!prevPeriodRange || previous === 0) {
      return { percent: 0, direction: 'neutral', label: trendLabel }
    }
    const pct = ((current - previous) / previous) * 100
    return {
      percent: Math.abs(pct),
      direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
      label: trendLabel,
    }
  }

  const trendLabel =
    period === 'today' ? 'vs ayer'
    : period === 'week' ? 'vs semana anterior'
    : period === 'month' ? 'vs mes anterior'
    : ''

  const prevTotalSold = prevCompletedSales.reduce((acc, s) => acc + Number(s.total), 0)
  const kpiTrends = {
    total: computeTrend(totalSold, prevTotalSold, trendLabel),
    transactions: computeTrend(transactions, prevCompletedSales.length, trendLabel),
  }

  const historyRows = useMemo(() =>
    filteredSales.map(s => ({ ...s, method: paymentsBySaleId.get(s.id) ?? 'sin dato' })),
    [filteredSales, paymentsBySaleId])

  // Y-axis labels for chart
  const yLabels = Array.from({ length: 5 }, (_, i) => {
    const val = maxChartValue * (1 - i / 4)
    return val >= 1000 ? `$${(val / 1000).toFixed(0)}k` : `$${Math.round(val)}`
  })

  const periodTabs = [
    { key: 'today', label: 'Hoy' },
    { key: 'week', label: 'Esta semana' },
    { key: 'month', label: 'Este mes' },
    { key: 'custom', label: 'Personalizado' },
    { key: 'history', label: 'Historial' },
  ] as const

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Dashboard" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          {/* Period tabs — pill style */}
          <div className="pill-tabs">
            {periodTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setPeriod(tab.key)}
                className={`pill-tab${period === tab.key ? ' pill-tab-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {(period === 'custom' || period === 'history') && (
            <div className="flex gap-3 items-center">
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-9 w-40 rounded-lg text-sm" />
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-9 w-40 rounded-lg text-sm" />
              <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => { setFromDate(''); setToDate('') }}>
                Limpiar
              </Button>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <KPICard
              icon="$"
              iconBg="bg-emerald-100 dark:bg-emerald-950/50"
              iconColor="text-emerald-700 dark:text-emerald-400"
              label="TOTAL VENDIDO"
              value={`$${totalSold.toLocaleString('es-AR')}`}
              trend={trendLabel ? kpiTrends.total : undefined}
            />
            <KPICard
              icon="T"
              iconBg="bg-amber-100 dark:bg-amber-950/50"
              iconColor="text-amber-700 dark:text-amber-400"
              label="TRANSACCIONES"
              value={String(transactions)}
              trend={trendLabel ? kpiTrends.transactions : undefined}
            />
            <KPICard
              icon="!"
              iconBg="bg-red-100 dark:bg-red-950/50"
              iconColor="text-red-600 dark:text-red-400"
              label="STOCK BAJO / SIN STOCK"
              value={String(lowStockProducts.length)}
              subtitle={`${outOfStockCount} sin stock · ${lowStockCount} stock bajo`}
            />
            <KPICard
              icon="PM"
              iconBg="bg-emerald-100 dark:bg-emerald-950/50"
              iconColor="text-emerald-700 dark:text-emerald-400"
              label="PAGO MÁS USADO"
              value={mostUsedPayment ? normalizePayment(mostUsedPayment.method) : '—'}
              subtitle={mostUsedPayment ? `${mostUsedPayment.count} de ${transactions} transacciones` : undefined}
            />
          </div>

          {/* Charts row */}
          <div className="surface-card p-6">
            <p className="font-semibold text-heading mb-4">
              Ventas por {period === 'today' ? 'hora' : 'día'} — {period === 'today' ? 'hoy' : period === 'week' ? 'esta semana' : 'período'}
            </p>
            {chartData.every(d => d.value === 0) ? (
              <p className="text-sm text-hint h-48 flex items-center justify-center">Sin datos para el período</p>
            ) : (
              <div className="flex h-56">
                {/* Y axis */}
                <div className="flex flex-col justify-between pr-3 text-xs text-hint py-1 shrink-0">
                  {yLabels.map(l => <span key={l}>{l}</span>)}
                </div>
                {/* Bars */}
                <div className="flex-1 flex items-end gap-1.5 pl-2 pb-1">
                  {chartData.map(bar => (
                    <div key={bar.label} className="flex-1 flex flex-col items-center justify-end h-full">
                      <div
                        className="w-full max-w-[32px] bg-primary/80 hover:bg-primary rounded-t-lg transition-all mx-auto"
                        style={{ height: `${maxChartValue > 0 ? (bar.value / maxChartValue) * 100 : 0}%`, minHeight: bar.value > 0 ? 4 : 0 }}
                      />
                      <span className="text-[11px] text-hint mt-1.5 truncate w-full text-center">
                        {bar.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom row: top products + stock alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="surface-card p-6">
              <p className="font-semibold text-heading mb-4">Productos más vendidos</p>
              <div className="space-y-3">
                {topProducts.length === 0 ? (
                  <p className="text-sm text-hint">Sin datos</p>
                ) : (
                  topProducts.map((row, i) => (
                    <div key={row.name + i} className="flex items-center gap-3">
                      <span className="text-xs text-hint w-5 shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-heading truncate">{row.name}</p>
                        <p className="text-xs text-hint">${row.amount.toLocaleString('es-AR')} recaudado</p>
                      </div>
                      <span className="text-sm font-semibold text-body shrink-0">{row.qty} uds</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="surface-card p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-heading">Alertas de stock</p>
                <Link href="/inventory" className="text-xs text-primary font-medium hover:underline">
                  Ver stock →
                </Link>
              </div>
              {lowStockProducts.length === 0 ? (
                <p className="text-sm text-hint">No hay alertas activas</p>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-4 pr-1">
                  {outOfStock.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">Sin stock ({outOfStock.length})</p>
                      <div className="space-y-1.5">
                        {outOfStock.map(product => (
                          <div key={product.id} className="rounded-xl px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50">
                            <p className="text-sm font-medium text-heading">{product.name}</p>
                            <p className="text-xs text-red-600 dark:text-red-400">Sin stock · mín. {product.min_stock}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {lowStock.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">Stock bajo ({lowStock.length})</p>
                      <div className="space-y-1.5">
                        {lowStock.map(product => (
                          <div key={product.id} className="rounded-xl px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                            <p className="text-sm font-medium text-heading">{product.name}</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">{product.stock} uds · mín. {product.min_stock}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {period === 'history' && <SalesHistoryTable rows={historyRows} businessId={businessId} />}
        </div>
      </div>
    </div>
  )
}
