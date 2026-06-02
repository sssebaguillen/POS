'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, PackageX } from 'lucide-react'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type { DeadStockRow, DeadStockSummary, DeadStockBucket } from '@/lib/types'

interface Props {
  rows: DeadStockRow[]            // todas las filas marcadas (never_sold + dead), ya traídas
  summary: DeadStockSummary | null
  bucket: DeadStockBucket | null  // estado inicial (desde la URL)
  page: number                    // estado inicial (desde la URL)
  pageSize: number
}

const BUCKET_META: Record<DeadStockBucket, { label: string; badge: string; hint: string }> = {
  dead: {
    label: 'Sin movimiento',
    badge: 'bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30',
    hint: 'Se vendió alguna vez, pero lleva meses sin moverse. Liquidá, rematá o dejá de reponer.',
  },
  never_sold: {
    label: 'Nunca vendido',
    badge: 'bg-slate-500/10 text-slate-600 border border-slate-500/20 dark:bg-slate-400/15 dark:text-slate-300 dark:border-slate-400/30',
    hint: 'Nunca se vendió desde que entró. Evaluá liquidar o devolver al proveedor.',
  },
}

const CHIP_ACTIVE = 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'

export default function DeadStockLens({ rows, summary, bucket: initialBucket, page: initialPage, pageSize }: Props) {
  const pathname = usePathname()
  const formatMoney = useFormatMoney()

  const [bucket, setBucket] = useState<DeadStockBucket | null>(initialBucket)
  const [page, setPage] = useState(initialPage)

  const flagged = summary?.products_flagged ?? 0
  const missingCost = summary?.products_missing_cost ?? 0

  // Filtro por bucket + paginación en memoria: el cambio de chip es instantáneo (sin red).
  const filtered = useMemo(
    () => (bucket ? rows.filter(r => r.bucket === bucket) : rows),
    [rows, bucket]
  )
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  )

  function syncUrl(nextBucket: DeadStockBucket | null, nextPage: number) {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams()
    sp.set('lens', 'dead')
    if (nextBucket) sp.set('bucket', nextBucket)
    sp.set('page', String(nextPage))
    window.history.replaceState(window.history.state, '', `${pathname}?${sp.toString()}`)
  }

  function selectBucket(next: DeadStockBucket | null) {
    setBucket(next)
    setPage(1)
    syncUrl(next, 1)
  }

  function goToPage(next: number) {
    setPage(next)
    syncUrl(bucket, next)
  }

  const csvData = useMemo(
    () =>
      filtered.map(r => ({
        Producto: r.name,
        SKU: r.sku ?? '',
        Categoría: r.category_name ?? '',
        Marca: r.brand_name ?? '',
        Estado: r.is_active === false ? 'Discontinuado' : 'Activo',
        Clasificación: BUCKET_META[r.bucket].label,
        Stock: r.effective_stock,
        'Capital inmovilizado': r.frozen_capital,
        'Días sin venta': r.days_since_last_sale ?? 'Nunca',
      })),
    [filtered]
  )

  const bucketChips: { value: DeadStockBucket | null; label: string; count: number }[] = [
    { value: null, label: 'Todos', count: flagged },
    { value: 'dead', label: 'Sin movimiento', count: summary?.count_by_bucket.dead ?? 0 },
    { value: 'never_sold', label: 'Nunca vendido', count: summary?.count_by_bucket.never_sold ?? 0 },
  ]

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="surface-card p-4 space-y-1">
          <p className="text-label text-hint">Capital inmovilizado</p>
          <p className="text-2xl font-bold text-heading leading-none">
            {formatMoney(summary?.total_frozen_capital ?? 0)}
          </p>
        </div>
        <div className="surface-card p-4 space-y-1">
          <p className="text-label text-hint">Productos sin rotación</p>
          <p className="text-2xl font-bold text-heading leading-none">
            {flagged.toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      {/* Nudge: costo sin cargar */}
      {missingCost > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <p>
            {missingCost} {missingCost === 1 ? 'producto sin costo cargado' : 'productos sin costo cargado'} —
            cargá el costo en Inventario para ver su capital inmovilizado real.
          </p>
        </div>
      )}

      {/* Chips + export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {bucketChips.map(chip => (
            <button
              key={chip.label}
              onClick={() => selectBucket(chip.value)}
              title={chip.value ? BUCKET_META[chip.value].hint : undefined}
              className={cn('pill-tab text-hint hover:text-body', bucket === chip.value && CHIP_ACTIVE)}
            >
              {chip.label}
              <span className="ml-1.5 text-xs opacity-70">{chip.count}</span>
            </button>
          ))}
        </div>
        <ExportCSVButton data={csvData} filename="stock-inmovilizado" />
      </div>

      {/* Tabla */}
      <div className="surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-edge/60">
            <tr className="text-xs text-hint font-medium">
              <th className="text-left px-4 py-3">Producto</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Categoría</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Clasificación</th>
              <th className="text-right px-4 py-3">Stock</th>
              <th className="text-right px-4 py-3">Capital</th>
              <th className="text-right px-4 py-3">Sin venta</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-hint py-16">
                  <PackageX size={28} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium text-body">Sin stock inmovilizado</p>
                  <p className="text-xs text-hint mt-1">Tu inventario rota bien — no hay productos parados con capital trabado.</p>
                </td>
              </tr>
            ) : (
              pageRows.map(row => {
                const meta = BUCKET_META[row.bucket]
                return (
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
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span
                        title={meta.hint}
                        className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', meta.badge)}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-heading">{row.effective_stock}</td>
                    <td className="px-4 py-3 text-right font-semibold text-heading">
                      {row.missing_cost
                        ? <span className="text-hint font-normal" title="Sin costo cargado">—</span>
                        : formatMoney(row.frozen_capital)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.days_since_last_sale === null
                        ? <span className="text-hint">Nunca</span>
                        : `${row.days_since_last_sale} días`}
                    </td>
                  </tr>
                )
              })
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
