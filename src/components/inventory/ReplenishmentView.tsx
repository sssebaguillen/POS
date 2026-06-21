'use client'

import { useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import { cn } from '@/lib/utils'
import type { ReplenishmentRow, ReplenishmentSummary } from '@/lib/types'

type StockFilter = 'all' | 'out' | 'low'

const STOCK_FILTERS: { value: StockFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'out', label: 'Sin stock' },
  { value: 'low', label: 'Stock bajo' },
]

interface Props {
  rows: ReplenishmentRow[]
  summary: ReplenishmentSummary | null
}

function formatVelocity(v: number): string {
  if (v <= 0) return '—'
  if (v >= 1) return v.toFixed(1)
  return v.toFixed(2)
}

function DaysToStockout({ days, outOfStock }: { days: number | null; outOfStock: boolean }) {
  if (outOfStock) {
    return <span className="text-destructive font-semibold">Sin stock</span>
  }
  if (days == null) {
    return <span className="text-hint">Sin ventas recientes</span>
  }
  const tone =
    days <= 7 ? 'text-destructive font-semibold'
    : days <= 14 ? 'text-warning font-medium'
    : 'text-body'
  return <span className={tone}>{days} {days === 1 ? 'día' : 'días'}</span>
}

export default function ReplenishmentView({ rows, summary }: Props) {
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (stockFilter === 'out' && r.effective_stock > 0) return false
      if (stockFilter === 'low' && r.effective_stock <= 0) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.sku?.toLowerCase().includes(q) ?? false) ||
        (r.category_name?.toLowerCase().includes(q) ?? false) ||
        (r.brand_name?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, stockFilter, search])

  const csvData = useMemo(() =>
    filtered.map(r => ({
      Producto: r.name,
      SKU: r.sku ?? '',
      Categoría: r.category_name ?? '',
      Marca: r.brand_name ?? '',
      'Stock actual': r.effective_stock,
      Mínimo: r.min_stock,
      'Vel. diaria': r.daily_velocity,
      'Días hasta quiebre': r.days_to_stockout ?? '',
      'Sugerido (al mínimo)': r.suggested_qty,
    })),
    [filtered]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Reposición" breadcrumbs={[{ label: 'Inventario', href: '/inventory' }]}>
        <ExportCSVButton data={csvData} filename="reposicion" />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Productos a reponer</p>
              <p className="text-xl font-bold text-heading leading-none">
                {(summary?.products_count ?? rows.length).toLocaleString('es-AR')}
              </p>
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Sin stock</p>
              <p className="text-xl font-bold text-heading leading-none">
                {(summary?.out_of_stock_count ?? 0).toLocaleString('es-AR')}
              </p>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, SKU, categoría o marca..."
              className="h-9 max-w-xs flex-1 rounded-lg border border-edge bg-surface px-3 text-sm text-body placeholder:text-hint focus:border-primary/40 focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {STOCK_FILTERS.map(f => {
                const active = stockFilter === f.value
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStockFilter(f.value)}
                    className={cn(
                      'pill-tab',
                      active && 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30',
                    )}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-hint">
            Ordenado por urgencia (días hasta quiebre, según la venta de los últimos {summary?.window_days ?? 30} días).
            La cantidad sugerida es lo que falta para volver al mínimo configurado de cada producto.
          </p>

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <th className="text-left px-4 py-3">Producto</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">SKU</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Categoría</th>
                  <th className="text-right px-4 py-3">Stock</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Mínimo</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Vel./día</th>
                  <th className="text-right px-4 py-3">Días hasta quiebre</th>
                  <th className="text-right px-4 py-3">Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-hint py-12 text-sm">
                      {rows.length === 0
                        ? 'Tu stock está por encima del mínimo. Nada para reponer por ahora.'
                        : 'Sin resultados para este filtro.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map(row => {
                    const outOfStock = row.effective_stock <= 0
                    return (
                      <tr key={row.id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                        <td className="px-4 py-3 font-medium text-heading max-w-[200px]">
                          <span className="truncate block">{row.name}</span>
                          {row.has_variants && (
                            <span className="text-xs text-hint">Stock total de variantes</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-body hidden md:table-cell">{row.sku ?? '—'}</td>
                        <td className="px-4 py-3 text-body hidden lg:table-cell">{row.category_name ?? '—'}</td>
                        <td className={cn('px-4 py-3 text-right tabular-nums font-semibold', outOfStock ? 'text-destructive' : 'text-heading')}>
                          {row.effective_stock}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-body hidden md:table-cell">{row.min_stock}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-body hidden lg:table-cell">{formatVelocity(row.daily_velocity)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <DaysToStockout days={row.days_to_stockout} outOfStock={outOfStock} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-primary">
                          {row.suggested_qty > 0 ? `+${row.suggested_qty}` : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
