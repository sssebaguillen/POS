'use client'

import { useState, useMemo } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'

interface TopProductRow {
  id: string
  name: string
  sku: string | null
  category_name: string | null
  brand_name: string | null
  price: number
  cost: number
  units_sold: number
  revenue: number
  gross_profit: number
  transaction_count: number
}

type SortKey = 'units_sold' | 'revenue' | 'transaction_count' | 'gross_profit'

function SortButton({ col, onSort }: { col: SortKey; onSort: (col: SortKey) => void }) {
  return (
    <button onClick={() => onSort(col)} className="inline-flex items-center gap-1 hover:text-heading transition-colors">
      <ArrowUpDown size={12} />
    </button>
  )
}

interface Props {
  rows: TopProductRow[]
  total: number
  businessId: string | null
  period: string
  from?: string
  to?: string
  page: number
}

export default function TopProductsDetailView({ rows, total, period, from, to, page }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [sortKey, setSortKey] = useState<SortKey>('revenue' as SortKey)
  const [sortAsc, setSortAsc] = useState(false)

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(prev => !prev)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      return sortAsc ? Number(va) - Number(vb) : Number(vb) - Number(va)
    })
  }, [rows, sortKey, sortAsc])

  const csvData = useMemo(() =>
    sorted.map(r => ({
      Producto: r.name,
      SKU: r.sku ?? '',
      Categoría: r.category_name ?? '',
      Marca: r.brand_name ?? '',
      'Unidades vendidas': r.units_sold,
      Ingresos: r.revenue,
      'Margen bruto': r.gross_profit,
      Transacciones: r.transaction_count,
    })),
    [sorted]
  )

  function navigate(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    params.set('page', '1')
    if (periodNeedsCustomDates(newPeriod) && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function goToPage(p: number) {
    const params = new URLSearchParams()
    params.set('period', period)
    params.set('page', String(p))
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    router.push(`${pathname}?${params.toString()}`)
  }

  const totalPages = Math.ceil(total / 50)


  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Top productos" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename="top-productos" />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <DateRangeFilter
            value={period as DateRangePeriod}
            from={from}
            to={to}
            onChange={navigate}
          />

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">SKU</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Categoría</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Marca</th>
                  <th className="text-right px-4 py-3">
                    <span className="flex items-center justify-end gap-1">Unidades <SortButton col="units_sold" onSort={handleSort} /></span>
                  </th>
                  <th className="text-right px-4 py-3">
                    <span className="flex items-center justify-end gap-1">Ingresos <SortButton col="revenue" onSort={handleSort} /></span>
                  </th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">
                    <span className="flex items-center justify-end gap-1">Margen <SortButton col="gross_profit" onSort={handleSort} /></span>
                  </th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">
                    <span className="flex items-center justify-end gap-1">Transacciones <SortButton col="transaction_count" onSort={handleSort} /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-hint py-12 text-sm">Sin datos para el período</td>
                  </tr>
                ) : (
                  sorted.map((row, idx) => (
                    <tr key={row.id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3 text-hint text-xs">{(page - 1) * 50 + idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-heading">{row.name}</td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{row.sku ?? '—'}</td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{row.category_name ?? '—'}</td>
                      <td className="px-4 py-3 text-body hidden lg:table-cell">{row.brand_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-medium">{row.units_sold}</td>
                      <td className="px-4 py-3 text-right font-semibold text-heading">${(row.revenue ?? 0).toLocaleString('es-AR')}</td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        ${(row.gross_profit ?? 0).toLocaleString('es-AR')}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.transaction_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-hint">{total} productos en total</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                  className="px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Anterior
                </button>
                <span className="text-hint">{page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                  className="px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
