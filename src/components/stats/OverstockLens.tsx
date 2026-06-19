'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Package } from '@phosphor-icons/react/dist/ssr'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PopNumber from '@/components/shared/PopNumber'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type { OverstockRow, OverstockSummary } from '@/lib/types'

interface Props {
  rows: OverstockRow[]              // todas las filas con sobrestock, ya traídas
  summary: OverstockSummary | null
  page: number                      // estado inicial (desde la URL)
  pageSize: number
}

// Color del badge de cobertura según severidad (la severidad la comunica el número).
function coverageBadge(months: number): string {
  if (months >= 12) return 'bg-destructive/10 text-destructive border border-destructive/20'
  return 'bg-warning/10 text-warning border border-warning/20'
}

export default function OverstockLens({ rows, summary, page: initialPage, pageSize }: Props) {
  const pathname = usePathname()
  const formatMoney = useFormatMoney()

  const [page, setPage] = useState(initialPage)

  const productsCount = summary?.products_count ?? 0
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize]
  )

  function goToPage(next: number) {
    setPage(next)
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams()
    sp.set('lens', 'overstock')
    sp.set('page', String(next))
    window.history.replaceState(window.history.state, '', `${pathname}?${sp.toString()}`)
  }

  const csvData = useMemo(
    () =>
      rows.map(r => ({
        Producto: r.name,
        SKU: r.sku ?? '',
        Categoría: r.category_name ?? '',
        Marca: r.brand_name ?? '',
        Estado: r.is_active === false ? 'Discontinuado' : 'Activo',
        Stock: r.effective_stock,
        'Velocidad (u/mes)': r.monthly_velocity,
        'Meses de stock': r.months_of_stock,
        'Capital total': r.frozen_capital,
        'Excedente (capital comprado de más)': r.excess_capital,
      })),
    [rows]
  )

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="surface-card p-4 space-y-1">
          <p className="text-label text-hint">Capital comprado de más</p>
          <PopNumber className="text-2xl font-bold text-heading leading-none" value={formatMoney(summary?.total_excess_capital ?? 0)} />
          <p className="text-xs text-hint">Lo que excede 6 meses de cobertura</p>
        </div>
        <div className="surface-card p-4 space-y-1">
          <p className="text-label text-hint">Productos con sobrestock</p>
          <PopNumber className="text-2xl font-bold text-heading leading-none" value={productsCount.toLocaleString('es-AR')} />
        </div>
      </div>

      {/* Caption + export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-hint">
          Productos que rotan pero con 6+ meses de stock para su ritmo de venta. La plata no está perdida — frená la reposición.
        </p>
        <ExportCSVButton data={csvData} filename="sobrestock" />
      </div>

      {/* Tabla */}
      <div className="surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-edge/60">
            <tr className="text-xs text-hint font-medium">
              <th className="text-left px-4 py-3">Producto</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Categoría</th>
              <th className="text-right px-4 py-3">Stock</th>
              <th className="text-right px-4 py-3 hidden md:table-cell">Velocidad</th>
              <th className="text-right px-4 py-3">Meses de stock</th>
              <th className="text-right px-4 py-3">Excedente</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-hint py-16">
                  <Package size={28} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium text-body">Sin sobrestock</p>
                  <p className="text-xs text-hint mt-1">Comprás ajustado al ritmo de venta — no hay productos con stock de sobra.</p>
                </td>
              </tr>
            ) : (
              pageRows.map(row => (
                <tr key={row.id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                  <td className="px-4 py-3 max-w-[220px]">
                    <Link href="/inventory" className="font-medium text-heading hover:text-primary transition-colors block truncate">
                      {row.name}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      {row.sku && <span className="text-xs text-hint">{row.sku}</span>}
                      {row.is_active === false && (
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-hint bg-muted px-1.5 py-0.5 rounded">
                          Discontinuado
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-body hidden lg:table-cell">{row.category_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-heading">{row.effective_stock}</td>
                  <td className="px-4 py-3 text-right text-body hidden md:table-cell">{row.monthly_velocity} u/mes</td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', coverageBadge(row.months_of_stock))}>
                      {row.months_of_stock} m
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-heading">{formatMoney(row.excess_capital)}</td>
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
              disabled={safePage <= 1}
              onClick={() => goToPage(safePage - 1)}
              className="px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg disabled:opacity-40 disabled:cursor-not-allowed transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
            >
              Anterior
            </button>
            <span className="text-hint">{safePage} / {totalPages}</span>
            <button
              disabled={safePage >= totalPages}
              onClick={() => goToPage(safePage + 1)}
              className="px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg disabled:opacity-40 disabled:cursor-not-allowed transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </>
  )
}
