'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/shared/PageHeader'
import Link from 'next/link'

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
}

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function endOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

function startOfWeek(date: Date) {
  const copy = startOfDay(date)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  return copy
}

function isCompletedSale(status: string | null) {
  return status === null || status === 'completed'
}

const paymentColors: Record<string, string> = {
  cash: 'bg-emerald-600',
  card: 'bg-indigo-500',
  transfer: 'bg-amber-500',
  mercadopago: 'bg-sky-500',
}

const paymentLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mercadopago: 'MercadoPago',
}

export default function DashboardView({ sales, payments, saleItems, products }: Props) {
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

  const paymentBreakdown = useMemo(() => {
    const totals: Record<string, number> = {}
    completedSales.forEach(s => {
      const m = paymentsBySaleId.get(s.id) ?? 'sin dato'
      totals[m] = (totals[m] ?? 0) + Number(s.total)
    })
    const grand = Object.values(totals).reduce((a, b) => a + b, 0)
    return Object.entries(totals)
      .map(([method, amount]) => ({ method, amount, percent: grand > 0 ? (amount / grand) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
  }, [completedSales, paymentsBySaleId])

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

  const stockAlerts = lowStockProducts.sort((a, b) => a.stock - b.stock).slice(0, 6)

  const historyRows = useMemo(() =>
    filteredSales.map(s => ({ ...s, method: paymentsBySaleId.get(s.id) ?? 'sin dato' })),
    [filteredSales, paymentsBySaleId])

  function exportHistoryCsv() {
    const headers = ['id', 'fecha', 'hora', 'total', 'metodo', 'estado']
    const rows = historyRows.map(s => {
      const d = new Date(s.created_at)
      return [s.id, d.toLocaleDateString('es-AR'), d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), Number(s.total).toFixed(2), s.method, s.status ?? 'completed']
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dashboard-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

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
          {/* Period tabs (underline style) */}
          <div className="flex gap-6 border-b border-edge/60">
            {periodTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setPeriod(tab.key)}
                className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                  period === tab.key
                    ? 'text-heading border-heading'
                    : 'text-hint border-transparent hover:text-body'
                }`}
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
              iconBg="bg-emerald-100"
              iconColor="text-emerald-700"
              label="TOTAL VENDIDO"
              value={`$${totalSold.toLocaleString('es-AR')}`}
            />
            <KPICard
              icon="T"
              iconBg="bg-amber-100"
              iconColor="text-amber-700"
              label="TRANSACCIONES"
              value={String(transactions)}
            />
            <KPICard
              icon="!"
              iconBg="bg-red-100"
              iconColor="text-red-600"
              label="STOCK BAJO / SIN STOCK"
              value={String(lowStockProducts.length)}
              subtitle={`${outOfStockCount} sin stock · ${lowStockCount} stock bajo`}
            />
            <KPICard
              icon="PM"
              iconBg="bg-emerald-100"
              iconColor="text-emerald-700"
              label="PAGO MÁS USADO"
              value={mostUsedPayment ? (paymentLabels[mostUsedPayment.method] ?? mostUsedPayment.method) : '—'}
              subtitle={mostUsedPayment ? `${mostUsedPayment.count} de ${transactions} transacciones` : undefined}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
            {/* Vertical bar chart */}
            <div className="rounded-2xl bg-surface border border-edge/60 p-5">
              <p className="font-semibold text-heading mb-4">
                Ventas por {period === 'today' ? 'hora' : 'día'} — {period === 'today' ? 'hoy' : period === 'week' ? 'esta semana' : 'período'}
              </p>
              {chartData.every(d => d.value === 0) ? (
                <p className="text-sm text-hint h-48 flex items-center justify-center">Sin datos para el período</p>
              ) : (
                <div className="flex h-56">
                  {/* Y axis */}
                  <div className="flex flex-col justify-between pr-2 text-[10px] text-hint py-1">
                    {yLabels.map(l => <span key={l}>{l}</span>)}
                  </div>
                  {/* Bars */}
                  <div className="flex-1 flex items-end gap-1 border-l border-b border-edge-soft pl-1 pb-1">
                    {chartData.map(bar => (
                      <div key={bar.label} className="flex-1 flex flex-col items-center justify-end h-full">
                        <div
                          className="w-full max-w-[28px] bg-emerald-700 rounded-t transition-all mx-auto"
                          style={{ height: `${maxChartValue > 0 ? (bar.value / maxChartValue) * 100 : 0}%`, minHeight: bar.value > 0 ? 4 : 0 }}
                        />
                        <span className="text-[9px] text-hint mt-1 truncate w-full text-center">
                          {bar.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Payment breakdown */}
            <div className="rounded-2xl bg-surface border border-edge/60 p-5">
              <p className="font-semibold text-heading mb-4">Ingresos por método de pago</p>
              <div className="space-y-4">
                {paymentBreakdown.length === 0 ? (
                  <p className="text-sm text-hint">Sin ventas</p>
                ) : (
                  paymentBreakdown.map(row => (
                    <div key={row.method} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-body font-medium">
                          {paymentLabels[row.method] ?? row.method}
                        </span>
                        <span className="text-heading font-semibold">
                          ${row.amount.toLocaleString('es-AR')}{' '}
                          <span className="text-xs text-hint font-normal">{row.percent.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-alt">
                        <div
                          className={`h-2 rounded-full ${paymentColors[row.method] ?? 'bg-muted-foreground'}`}
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Bottom row: top products + stock alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-surface border border-edge/60 p-5">
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

            <div className="rounded-2xl bg-surface border border-edge/60 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-heading">Alertas de stock</p>
                <Link href="/inventory" className="text-xs text-emerald-700 font-medium hover:underline">
                  Ver stock →
                </Link>
              </div>
              <div className="space-y-2">
                {stockAlerts.length === 0 ? (
                  <p className="text-sm text-hint">No hay alertas activas</p>
                ) : (
                  stockAlerts.map(product => (
                    <div
                      key={product.id}
                      className={`rounded-xl px-4 py-3 ${
                        product.stock <= 0
                          ? 'bg-red-50 border border-red-200'
                          : 'bg-amber-50 border border-amber-200'
                      }`}
                    >
                      <p className="text-sm font-medium text-heading">{product.name}</p>
                      <p className={`text-xs ${product.stock <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {product.stock <= 0
                          ? 'Sin stock'
                          : `Stock bajo: ${product.stock} uds (mín. ${product.min_stock})`
                        }
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* History table (only shown in history mode) */}
          {period === 'history' && (
            <div className="rounded-2xl bg-surface border border-edge/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-heading">Historial detallado</p>
                <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={exportHistoryCsv} disabled={historyRows.length === 0}>
                  Exportar CSV
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-subtle border-b">
                      <th className="py-2 font-medium">Fecha</th>
                      <th className="py-2 font-medium">Método</th>
                      <th className="py-2 font-medium">Estado</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.slice(0, 25).map(sale => (
                      <tr key={sale.id} className="border-b last:border-b-0">
                        <td className="py-2 text-body">{new Date(sale.created_at).toLocaleString('es-AR')}</td>
                        <td className="py-2 text-body">{paymentLabels[sale.method] ?? sale.method}</td>
                        <td className="py-2 text-body">{sale.status ?? 'completed'}</td>
                        <td className="py-2 text-right font-medium">${Number(sale.total).toLocaleString('es-AR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KPICard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  subtitle,
}: {
  icon: string
  iconBg: string
  iconColor: string
  label: string
  value: string
  subtitle?: string
}) {
  return (
    <div className="rounded-2xl bg-surface border border-edge/60 p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center text-lg shrink-0`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-hint uppercase tracking-wider">{label}</p>
        <p className="text-xl font-bold text-heading leading-tight mt-0.5">{value}</p>
        {subtitle && <p className="text-[11px] text-hint mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}
