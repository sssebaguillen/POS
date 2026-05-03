'use client'

import { useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { usePillIndicator } from '@/hooks/usePillIndicator'

export interface CategorySalesRow {
  category_id: string | null
  category_name: string
  revenue: number
  units: number
  transactions: number
  distinct_products: number
}

export interface BrandRow {
  brand_id: string
  brand_name: string
  transaction_count: number
  units_sold: number
  revenue: number
  product_count: number
}

interface Props {
  rows: CategorySalesRow[] | BrandRow[]
  period: string
  from?: string
  to?: string
  tab: 'category' | 'brand'
}

export default function BreakdownDetailView({ rows, period, from, to, tab }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const { setRef, indicator } = usePillIndicator(tab)

  function setTab(newTab: 'category' | 'brand') {
    const params = new URLSearchParams()
    params.set('period', period)
    params.set('tab', newTab)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    router.push(`${pathname}?${params.toString()}`)
  }

  function navigate(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    params.set('tab', tab)
    if (periodNeedsCustomDates(newPeriod) && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)), [rows])
  const total = useMemo(() => sorted.reduce((acc, r) => acc + (r.revenue ?? 0), 0), [sorted])
  const leadingLabel = useMemo(() => {
    const first = sorted[0]
    if (!first) return null
    return tab === 'brand'
      ? (first as BrandRow).brand_name
      : (first as CategorySalesRow).category_name
  }, [sorted, tab])
  const leadingShare = useMemo(() => {
    if (!sorted[0] || total === 0) return 0
    return Math.round(((sorted[0].revenue ?? 0) / total) * 100)
  }, [sorted, total])

  const csvData = useMemo(() => {
    if (tab === 'brand') {
      return (sorted as BrandRow[]).map(r => ({
        Marca: r.brand_name,
        Ingresos: r.revenue,
        Unidades: r.units_sold,
        Transacciones: r.transaction_count,
        'Productos distintos': r.product_count,
      }))
    }
    return (sorted as CategorySalesRow[]).map(r => ({
      Categoría: r.category_name,
      Ingresos: r.revenue,
      Unidades: r.units,
      Transacciones: r.transactions,
      'Productos distintos': r.distinct_products,
    }))
  }, [sorted, tab])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Desglose" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename={`breakdown-${tab}`} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <DateRangeFilter
            value={period as DateRangePeriod}
            from={from}
            to={to}
            onChange={navigate}
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Ingresos del período</p>
              <p className="text-xl font-bold text-heading leading-none">{formatMoney(total)}</p>
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">{tab === 'category' ? 'Categorías' : 'Marcas'} con ventas</p>
              <p className="text-xl font-bold text-heading leading-none">{sorted.length}</p>
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">{tab === 'category' ? 'Categoría líder' : 'Marca líder'}</p>
              <p className="text-xl font-bold text-heading leading-none truncate" title={leadingLabel ?? '—'}>
                {leadingLabel ?? '—'}
              </p>
              {leadingShare > 0 && (
                <p className="text-caption text-hint">{leadingShare}% del total</p>
              )}
            </div>
          </div>

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
              ref={setRef('category')}
              onClick={() => setTab('category')}
              className={`pill-tab${tab === 'category' ? ' pill-tab-active' : ''}`}
            >
              Categoría
            </button>
            <button
              type="button"
              ref={setRef('brand')}
              onClick={() => setTab('brand')}
              className={`pill-tab${tab === 'brand' ? ' pill-tab-active' : ''}`}
            >
              Marca
            </button>
          </div>

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <th className="text-left px-4 py-3">{tab === 'category' ? 'Categoría' : 'Marca'}</th>
                  <th className="text-right px-4 py-3">Ingresos</th>
                  <th className="text-right px-4 py-3">% del total</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Unidades</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Transacciones</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Productos</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-hint py-12 text-sm">Sin datos para el período</td>
                  </tr>
                ) : tab === 'brand'
                  ? (sorted as BrandRow[]).map(row => (
                    <tr key={row.brand_id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3 font-medium text-heading">{row.brand_name}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatMoney(row.revenue ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-hint text-xs">
                        {total > 0 ? `${(((row.revenue ?? 0) / total) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.units_sold}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.transaction_count}</td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">{row.product_count}</td>
                    </tr>
                  ))
                  : (sorted as CategorySalesRow[]).map(row => (
                    <tr key={row.category_id ?? row.category_name} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3 font-medium text-heading">{row.category_name}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatMoney(row.revenue ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-hint text-xs">
                        {total > 0 ? `${(((row.revenue ?? 0) / total) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.units}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.transactions}</td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">{row.distinct_products}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
