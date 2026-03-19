'use client'

import { useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter, { type DateRangePeriod } from '@/components/shared/DateRangeFilter'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'

interface CategorySalesRow {
  category_id: string | null
  category_name: string
  revenue: number
  units: number
  transactions: number
  distinct_products: number
}

interface Props {
  rows: CategorySalesRow[]
  businessId: string | null
  period: string
  from?: string
  to?: string
  tab: 'category' | 'brand'
}

export default function BreakdownDetailView({ rows, period, from, to, tab }: Props) {
  const router = useRouter()
  const pathname = usePathname()

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
    if (newPeriod === 'personalizado' && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)), [rows])
  const total = useMemo(() => sorted.reduce((acc, r) => acc + (r.revenue ?? 0), 0), [sorted])

  const csvData = useMemo(() =>
    sorted.map(r => ({
      Categoría: r.category_name,
      Ingresos: r.revenue,
      Unidades: r.units,
      Transacciones: r.transactions,
      'Productos distintos': r.distinct_products,
    })),
    [sorted]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Breakdown" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
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

          <div className="pill-tabs">
            <button
              onClick={() => setTab('category')}
              className={`pill-tab${tab === 'category' ? ' pill-tab-active' : ''}`}
            >
              Categoría
            </button>
            <button
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
                ) : (
                  sorted.map(row => (
                    <tr key={row.category_id ?? row.category_name} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3 font-medium text-heading">{row.category_name}</td>
                      <td className="px-4 py-3 text-right font-semibold">${(row.revenue ?? 0).toLocaleString('es-AR')}</td>
                      <td className="px-4 py-3 text-right text-hint text-xs">
                        {total > 0 ? `${(((row.revenue ?? 0) / total) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.units}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.transactions}</td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">{row.distinct_products}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
