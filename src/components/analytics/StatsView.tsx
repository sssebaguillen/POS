'use client'

import { useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { endOfDay, isCompletedSale, startOfDay, startOfWeek } from '@/components/analytics/utils'

type Period = 'today' | 'week' | 'month' | 'custom'
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
  sku: string | null
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

function inferBrandFromSku(sku: string | null) {
  if (!sku) return 'Sin marca'
  const token = sku.split('-')[0].trim()
  return token.length > 0 ? token : 'Sin marca'
}

export default function StatsView({ sales, payments, saleItems, products, categories }: Props) {
  const [period, setPeriod] = useState<Period>('today')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('revenue')
  const [rankingMode, setRankingMode] = useState<RankingMode>('amount')
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('category')

  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const categoriesById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  const range = useMemo(() => {
    const now = new Date()
    if (period === 'today') return { from: startOfDay(now), to: endOfDay(now) }
    if (period === 'week') return { from: startOfWeek(now), to: endOfDay(now) }
    if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }

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

  const totalRevenue = filteredSales.reduce((acc, sale) => acc + Number(sale.total), 0)
  const totalUnits = filteredItems.reduce((acc, item) => acc + Number(item.quantity), 0)
  const avgTicket = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0

  const peakDay = useMemo(() => {
    const byDay: Record<string, number> = {}
    filteredSales.forEach(sale => {
      const key = new Date(sale.created_at).toLocaleDateString('es-AR')
      byDay[key] = (byDay[key] ?? 0) + Number(sale.total)
    })
    const winner = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]
    return winner ? winner[0] : '-'
  }, [filteredSales])

  const evolution = useMemo(() => {
    const grouped: Record<string, { label: string; revenue: number; units: number }> = {}
    filteredSales.forEach(sale => {
      const dayKey = sale.created_at.slice(0, 10)
      if (!grouped[dayKey]) {
        grouped[dayKey] = {
          label: new Date(`${dayKey}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
          revenue: 0,
          units: 0,
        }
      }
      grouped[dayKey].revenue += Number(sale.total)
    })

    filteredItems.forEach(item => {
      const createdAt = saleCreatedAtById.get(item.sale_id)
      if (!createdAt) return
      const dayKey = createdAt.slice(0, 10)
      if (!grouped[dayKey]) {
        grouped[dayKey] = {
          label: new Date(`${dayKey}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
          revenue: 0,
          units: 0,
        }
      }
      grouped[dayKey].units += Number(item.quantity)
    })

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value)
  }, [filteredSales, filteredItems, saleCreatedAtById])

  const maxEvolution = Math.max(
    ...evolution.map(point => (evolutionMode === 'revenue' ? point.revenue : point.units)),
    1
  )

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
    const map: Record<string, number> = {}

    filteredItems.forEach(item => {
      if (!item.product_id) return
      const product = productsById.get(item.product_id)
      if (!product) return

      const key = breakdownMode === 'category'
        ? categoriesById.get(product.category_id ?? '') ?? 'Sin categoría'
        : inferBrandFromSku(product.sku)

      map[key] = (map[key] ?? 0) + Number(item.total)
    })

    const total = Object.values(map).reduce((acc, value) => acc + value, 0)

    return Object.entries(map)
      .map(([label, value]) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [filteredItems, productsById, categoriesById, breakdownMode])

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

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Estadísticas" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          {/* Period tabs (underline) */}
          <div className="flex gap-6 border-b border-edge/60">
            {([
              { key: 'today', label: 'Hoy' },
              { key: 'week', label: 'Esta semana' },
              { key: 'month', label: 'Este mes' },
              { key: 'custom', label: 'Personalizado' },
            ] as const).map(tab => (
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

          {period === 'custom' && (
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
            <div className="rounded-2xl bg-surface border border-edge/60 p-4">
              <p className="text-[10px] font-semibold text-hint uppercase tracking-wider">Ingresos totales</p>
              <p className="text-xl font-bold text-heading mt-0.5">${totalRevenue.toLocaleString('es-AR')}</p>
            </div>
            <div className="rounded-2xl bg-surface border border-edge/60 p-4">
              <p className="text-[10px] font-semibold text-hint uppercase tracking-wider">Unidades vendidas</p>
              <p className="text-xl font-bold text-heading mt-0.5">{totalUnits}</p>
            </div>
            <div className="rounded-2xl bg-surface border border-edge/60 p-4">
              <p className="text-[10px] font-semibold text-hint uppercase tracking-wider">Ticket promedio</p>
              <p className="text-xl font-bold text-heading mt-0.5">${avgTicket.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-2xl bg-surface border border-edge/60 p-4">
              <p className="text-[10px] font-semibold text-hint uppercase tracking-wider">Día pico</p>
              <p className="text-xl font-bold text-heading mt-0.5">{peakDay}</p>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
            {/* Evolution chart */}
            <div className="rounded-2xl bg-surface border border-edge/60 p-5 space-y-3">
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

              {evolution.length === 0 ? (
                <p className="text-sm text-hint h-48 flex items-center justify-center">Sin datos</p>
              ) : (
                <div className="space-y-2">
                  {evolution.map(point => {
                    const value = evolutionMode === 'revenue' ? point.revenue : point.units
                    return (
                      <div key={point.label} className="grid grid-cols-[70px_1fr_80px] items-center gap-2 text-xs">
                        <span className="text-subtle">{point.label}</span>
                        <div className="h-2 bg-surface-alt rounded-full overflow-hidden">
                          <div className="h-2 bg-primary rounded-full" style={{ width: `${(value / maxEvolution) * 100}%` }} />
                        </div>
                        <span className="text-right text-body">{evolutionMode === 'revenue' ? `$${value.toLocaleString('es-AR')}` : value}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Payment methods */}
            <div className="rounded-2xl bg-surface border border-edge/60 p-5 space-y-4">
              <p className="font-semibold text-heading">Métodos de pago</p>
              {paymentBreakdown.length === 0 ? (
                <p className="text-sm text-hint">Sin datos</p>
              ) : (
                paymentBreakdown.map(row => (
                  <div key={row.method} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-body font-medium">{paymentLabels[row.method] ?? row.method}</span>
                      <span className="text-subtle text-xs">{row.percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-alt">
                      <div className={`h-2 rounded-full ${paymentColors[row.method] ?? 'bg-hint'}`} style={{ width: `${row.percent}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Ranking */}
            <div className="rounded-2xl bg-surface border border-edge/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-heading">Ranking de productos</p>
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
            <div className="rounded-2xl bg-surface border border-edge/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-heading">Breakdown</p>
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
        </div>
      </div>
    </div>
  )
}
