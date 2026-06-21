'use client'

import { useState, useMemo } from 'react'
import { ArrowUp, ArrowDown, ArrowsDownUp } from '@phosphor-icons/react/dist/ssr'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import type { StatsKpis } from '@/lib/types'

export interface TopProductRow {
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

function marginPctOf(row: TopProductRow): number | null {
  if (!row.revenue) return null
  // gross_profit = revenue − Σ(qty×cost) y el costo nunca es negativo, así que
  // gross_profit >= revenue ⟺ costo total = 0 (producto sin costo cargado): el
  // margen sería un 100% engañoso. Devolvemos null para mostrar "—" en su lugar.
  if ((row.gross_profit ?? 0) >= row.revenue) return null
  return ((row.gross_profit ?? 0) / row.revenue) * 100
}

function SortIcon({ col, sortKey, sortAsc }: { col: SortKey; sortKey: SortKey; sortAsc: boolean }) {
  if (col !== sortKey) return <ArrowsDownUp size={12} className="text-hint/60" />
  return sortAsc
    ? <ArrowUp size={12} className="text-primary" />
    : <ArrowDown size={12} className="text-primary" />
}

interface Props {
  rows: TopProductRow[]
  total: number
  kpis: StatsKpis | null
  period: string
  from?: string
  to?: string
  page: number
}

export default function TopProductsDetailView({ rows, total, kpis, period, from, to, page }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
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
      'Margen bruto': marginPctOf(r) != null ? r.gross_profit : '',
      '% Margen': marginPctOf(r) != null ? Number(marginPctOf(r)!.toFixed(1)) : '',
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

  function thClass(col: SortKey, extraClass = '') {
    const isActive = sortKey === col
    return `px-4 py-3 cursor-pointer select-none transition-colors hover:text-heading ${isActive ? 'text-primary font-semibold' : ''} ${extraClass}`
  }

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

          {/* Summary KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Ingresos del período</p>
              <PopNumber className="text-xl font-bold text-heading leading-none" value={formatMoney(kpis?.total_revenue ?? 0)} />
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Unidades vendidas</p>
              <PopNumber className="text-xl font-bold text-heading leading-none" value={(kpis?.total_units ?? 0).toLocaleString('es-AR')} />
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Productos con ventas</p>
              <PopNumber className="text-xl font-bold text-heading leading-none" value={total.toLocaleString('es-AR')} />
            </div>
          </div>

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">SKU</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Categoría</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Marca</th>
                  <th
                    className={`text-right hidden md:table-cell ${thClass('units_sold')}`}
                    onClick={() => handleSort('units_sold')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Unidades
                      <SortIcon col="units_sold" sortKey={sortKey} sortAsc={sortAsc} />
                    </span>
                  </th>
                  <th
                    className={`text-right ${thClass('revenue')}`}
                    onClick={() => handleSort('revenue')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Ingresos
                      <SortIcon col="revenue" sortKey={sortKey} sortAsc={sortAsc} />
                    </span>
                  </th>
                  <th
                    className={`text-right hidden lg:table-cell ${thClass('gross_profit')}`}
                    onClick={() => handleSort('gross_profit')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Margen
                      <SortIcon col="gross_profit" sortKey={sortKey} sortAsc={sortAsc} />
                    </span>
                  </th>
                  <th
                    className={`text-right hidden md:table-cell ${thClass('transaction_count')}`}
                    onClick={() => handleSort('transaction_count')}
                  >
                    <span className="flex items-center justify-end gap-1">
                      Transacciones
                      <SortIcon col="transaction_count" sortKey={sortKey} sortAsc={sortAsc} />
                    </span>
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
                      <td className="px-4 py-3 font-medium text-heading max-w-[180px] truncate">{row.name}</td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{row.sku ?? '—'}</td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{row.category_name ?? '—'}</td>
                      <td className="px-4 py-3 text-body hidden lg:table-cell">{row.brand_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-medium hidden md:table-cell">{row.units_sold}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${sortKey === 'revenue' ? 'text-primary' : 'text-heading'}`}>
                        {formatMoney(row.revenue ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        {marginPctOf(row) != null ? (
                          <>
                            <div className="font-medium text-heading">{formatMoney(row.gross_profit ?? 0)}</div>
                            <div className="text-xs text-hint">{marginPctOf(row)!.toFixed(0)}%</div>
                          </>
                        ) : (
                          <span className="text-hint" title="Sin costo cargado">—</span>
                        )}
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
                  className="px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg disabled:opacity-40 disabled:cursor-not-allowed transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                >
                  Anterior
                </button>
                <span className="text-hint">{page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                  className="px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg disabled:opacity-40 disabled:cursor-not-allowed transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
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
