'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { type DateRangePeriod } from '@/lib/date-utils'
import KPICard from '@/components/shared/KPICard'
import Link from 'next/link'
import { isCompletedSale, getDateRange, getPreviousPeriodRange } from '@/lib/date-utils'
import type { PaymentMethod } from '@/lib/constants/domain'
import SalesHistoryTable from '@/components/dashboard/SalesHistoryTable'
import BalanceWidget from '@/components/dashboard/BalanceWidget'
import RecentActivityWidget from '@/components/dashboard/RecentActivityWidget'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import type { BusinessBalance } from '@/components/expenses/types'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import type { SupportedCurrencyCode } from '@/lib/constants/currencies'
import OnboardingWizard, { type OnboardingWizardProfile } from '@/components/onboarding/OnboardingWizard'

interface SaleRecord {
  id: string
  subtotal: number
  discount: number
  total: number
  created_at: string
  status: string | null
  operator_name: string | null
}

interface PaymentRecord {
  sale_id: string
  method: PaymentMethod
  amount: number
  created_at: string
}

interface SaleItemRecord {
  sale_id: string
  product_id: string | null
  quantity: number
  total: number
}

interface SaleHistoryRow extends SaleRecord {
  method: PaymentMethod | 'sin dato'
  product_names: string[]
}

interface RecentSaleRow {
  id: string
  total: number
  method: PaymentMethod | 'sin dato'
  created_at: string
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
  businessName: string
  balance: BusinessBalance
  onboardingProfile: OnboardingWizardProfile | null
  showOnboardingWizard: boolean
  initialBusinessSettings: Record<string, unknown> | null
  initialCurrency: SupportedCurrencyCode
  operatorId: string | null
  stockWriteAllowed: boolean
  wizardCategories: { id: string; name: string; icon: string }[]
  wizardBrands: InventoryBrand[]
  wizardPriceLists: PriceList[]
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
  sales,
  payments,
  saleItems,
  products,
  businessId,
  businessName,
  balance,
  onboardingProfile,
  showOnboardingWizard,
  initialBusinessSettings,
  initialCurrency,
  operatorId,
  stockWriteAllowed,
  wizardCategories,
  wizardBrands,
  wizardPriceLists,
}: Props) {
  const router = useRouter()
  const [period, setPeriod] = useState<DateRangePeriod>('hoy')
  const [showHistory, setShowHistory] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [suppressWizardLocal, setSuppressWizardLocal] = useState(false)

  useEffect(() => {
    if (!showOnboardingWizard) {
      setSuppressWizardLocal(false)
    }
  }, [showOnboardingWizard])

  const wizardOpen = showOnboardingWizard && !suppressWizardLocal

  const { setRef, indicator } = usePillIndicator(showHistory ? 'history' : 'overview')

  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const productNamesBySaleId = useMemo(() => {
    const map = new Map<string, string[]>()
    saleItems.forEach(item => {
      if (!item.product_id) return
      // Get product name from the products map
      const product = productsById.get(item.product_id)
      const name = product?.name ?? null
      if (!name) return
      const current = map.get(item.sale_id)
      if (current) {
        if (!current.includes(name)) current.push(name)
      } else {
        map.set(item.sale_id, [name])
      }
    })
    return map
  }, [saleItems, productsById])

  const paymentsBySaleId = useMemo(() => {
    const map = new Map<string, PaymentMethod>()
    const ordered = [...payments].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    ordered.forEach(p => { if (!map.has(p.sale_id)) map.set(p.sale_id, p.method) })
    return map
  }, [payments])

  const periodRange = useMemo(
    () => getDateRange(period, fromDate, toDate),
    [period, fromDate, toDate]
  )

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

  const totalSold = useMemo(
    () => completedSales.reduce((acc, s) => acc + Number(s.total), 0),
    [completedSales]
  )
  const transactions = completedSales.length
  const lowStockProducts = useMemo(
    () => products.filter(p => p.is_active && p.stock <= p.min_stock),
    [products]
  )
  const outOfStockCount = useMemo(() => lowStockProducts.filter(p => p.stock <= 0).length, [lowStockProducts])
  const lowStockCount = useMemo(() => lowStockProducts.filter(p => p.stock > 0).length, [lowStockProducts])

  // Vertical bar chart data
  const chartData = useMemo(() => {
    if (period === 'hoy') {
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

  const transactionsChartData = useMemo(() => {
    if (period === 'hoy') {
      return Array.from({ length: 13 }, (_, i) => {
        const hour = i + 8
        const transactionsCount = completedSales
          .filter(s => new Date(s.created_at).getHours() === hour)
          .length
        return { label: `${hour.toString().padStart(2, '0')}:00`, transactions: transactionsCount }
      })
    }
    const groups = new Map<string, number>()
    completedSales.forEach(s => {
      const dayKey = s.created_at.slice(0, 10)
      groups.set(dayKey, (groups.get(dayKey) ?? 0) + 1)
    })
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, transactionsCount]) => ({
        label: new Date(`${dayKey}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
        transactions: transactionsCount,
      }))
  }, [completedSales, period])

  const maxChartValue = useMemo(() => Math.max(...chartData.map(d => d.value), 1), [chartData])

  const outOfStock = useMemo(
    () => lowStockProducts.filter(p => p.stock <= 0).sort((a, b) => a.stock - b.stock),
    [lowStockProducts]
  )
  const lowStock = useMemo(
    () => lowStockProducts.filter(p => p.stock > 0).sort((a, b) => a.stock - b.stock),
    [lowStockProducts]
  )

  // Trend: previous period range for comparison
  const prevPeriodRange = useMemo(() => {
    if (period !== 'hoy' && period !== 'semana' && period !== 'mes') return null
    return getPreviousPeriodRange(period, periodRange)
  }, [period, periodRange])

  const prevCompletedSales = useMemo(() => {
    if (!prevPeriodRange) return []
    return sales.filter(s => {
      const d = new Date(s.created_at)
      return d >= prevPeriodRange.from && d <= prevPeriodRange.to && isCompletedSale(s.status)
    })
  }, [sales, prevPeriodRange])

  const trendLabel = useMemo(() =>
    period === 'hoy' ? 'vs ayer'
    : period === 'semana' ? 'vs semana anterior'
    : period === 'mes' ? 'vs mes anterior'
    : ',',
    [period]
  )

  const prevTotalSold = useMemo(
    () => prevCompletedSales.reduce((acc, s) => acc + Number(s.total), 0),
    [prevCompletedSales]
  )
  const kpiTrends = useMemo(() => ({
    total: computeTrend(totalSold, prevTotalSold, trendLabel, prevPeriodRange !== null),
    transactions: computeTrend(transactions, prevCompletedSales.length, trendLabel, prevPeriodRange !== null),
  }), [totalSold, prevTotalSold, trendLabel, transactions, prevCompletedSales, prevPeriodRange])

  const historyRows = useMemo<SaleHistoryRow[]>(() =>
    filteredSales.map(s => ({
      ...s,
      method: paymentsBySaleId.get(s.id) ?? 'sin dato',
      product_names: productNamesBySaleId.get(s.id) ?? [],
    })),
    [filteredSales, paymentsBySaleId, productNamesBySaleId])

  const historyTableKey = useMemo(
    () => `${period}:${fromDate}:${toDate}`,
    [period, fromDate, toDate]
  )

  const recentSales = useMemo<RecentSaleRow[]>(
    () => completedSales
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(s => ({
        id: s.id,
        total: s.total,
        method: paymentsBySaleId.get(s.id) ?? 'sin dato',
        created_at: s.created_at,
      })),
    [completedSales, paymentsBySaleId]
  )

  const yLabels = useMemo(() =>
    Array.from({ length: 5 }, (_, i) => {
      const val = maxChartValue * (1 - i / 4)
      return val >= 1000 ? `$${(val / 1000).toFixed(0)}k` : `$${Math.round(val)}`
    }),
    [maxChartValue]
  )

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
      <PageHeader title="Dashboard" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                Historial de ventas
              </button>
            </div>
          </div>

          {showHistory ? (
            <SalesHistoryTable
              key={historyTableKey}
              rows={historyRows}
              businessId={businessId}
              businessName={businessName}
            />
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-3 gap-4 animate-fade-in">
                <KPICard
                  icon="$"
                  iconBg="bg-emerald-100 dark:bg-emerald-950/50"
                  iconColor="text-emerald-700 dark:text-emerald-400"
                  label="TOTAL VENDIDO"
                  value={`$${totalSold.toLocaleString('es-AR')}`}
                  trend={trendLabel ? kpiTrends.total : undefined}
                  sparkline={chartData.map(point => point.value)}
                />
                <KPICard
                  icon="T"
                  iconBg="bg-amber-100 dark:bg-amber-950/50"
                  iconColor="text-amber-700 dark:text-amber-400"
                  label="TRANSACCIONES"
                  value={String(transactions)}
                  trend={trendLabel ? kpiTrends.transactions : undefined}
                  sparkline={transactionsChartData.map(point => point.transactions)}
                />
                <KPICard
                  icon="!"
                  iconBg="bg-red-100 dark:bg-red-950/50"
                  iconColor="text-red-600 dark:text-red-400"
                  label="STOCK CRÍTICO"
                  value={String(lowStockProducts.length)}
                  subtitle={`${outOfStockCount} sin stock · ${lowStockCount} stock bajo`}
                >
                  {outOfStock.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {outOfStock.slice(0, 2).map(p => (
                        <div key={p.id} className="flex items-center gap-2">
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-400/70" />
                          <span className="text-xs text-hint truncate">{p.name}</span>
                        </div>
                      ))}
                      {outOfStock.length > 2 && (
                        <p className="text-xs text-hint pl-3.5">
                          +{outOfStock.length - 2} más
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
                    chartData={chartData}
                  />
                </div>
                <div className="xl:col-span-1 h-full">
                  <RecentActivityWidget sales={recentSales} />
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="surface-card p-6 animate-fade-in" style={{ animationDelay: '80ms' }}>
                  <p className="font-semibold text-heading mb-4 font-display">
                    {chartTitle}
                  </p>
                  {chartData.every(d => d.value === 0) ? (
                    <p className="text-sm text-hint h-48 flex items-center justify-center">Sin datos para el período</p>
                  ) : (
                    <div className="flex h-56">
                      <div className="flex flex-col justify-between pr-3 text-xs text-hint py-1 shrink-0">
                        {yLabels.map(l => <span key={l}>{l}</span>)}
                      </div>
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

                <div className="surface-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <p className="font-semibold text-heading font-display">Alertas de stock</p>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
