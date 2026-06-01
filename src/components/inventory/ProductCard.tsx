'use client'

import Image from 'next/image'
import { memo, useState } from 'react'
import { Package, Pencil, MoreVertical, Globe } from 'lucide-react'
import type { ProductCardProps } from '@/components/inventory/types'
import { getStatus, statusConfig } from '@/components/inventory/types'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function SelectionCheckbox({ checked, indeterminate = false, onClick }: { checked: boolean; indeterminate?: boolean; onClick: (e: React.MouseEvent) => void }) {
  const filled = checked || indeterminate
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 -m-1 touch-manipulation"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
    >
      <span className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
        filled ? 'bg-primary border-primary' : 'border-edge bg-surface'
      }`}>
        {indeterminate ? (
          <span className="block w-2.5 h-0.5 bg-white rounded-full" />
        ) : checked ? (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    </button>
  )
}

const ProductCard = memo(function ProductCard({
  product,
  readOnly,
  loadingId,
  selectionMode,
  isSelected,
  onToggleSelect,
  onEdit,
  onToggleActive,
  onToggleCatalog,
  onDelete,
  onQuickCategory,
  onQuickBrand,
  onViewStock,
}: ProductCardProps) {
  const formatMoney = useFormatMoney()
  const [menuOpen, setMenuOpen] = useState(false)
  const inCatalog = product.show_in_catalog ?? true
  const status = getStatus(product)
  const config = statusConfig[status]
  const margin = product.cost > 0 && product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0
  const loading = loadingId === product.id

  // Resting border: neutral for the healthy/common case, status-tinted only when
  // the product needs attention — keeps the grid calm and draws the eye to problems.
  const restBorder = isSelected
    ? 'border-primary'
    : status === 'ok'
      ? 'border-edge/60'
      : config.border

  const stockColor = status === 'out'
    ? 'text-destructive'
    : status === 'low'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-heading'

  return (
    <article
      className={`group/card relative flex flex-col rounded-xl border bg-surface overflow-hidden transition-[border-color,background-color] duration-150 ease-[var(--ease-out)] hover:bg-accent/30 ${restBorder} ${status === 'discontinued' ? 'opacity-75' : ''}`}
    >
      {/* Image band */}
      <div className="relative aspect-[3/2]">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            className="object-cover"
            unoptimized={product.image_source === 'url'}
          />
        ) : (
          <div className="absolute inset-0 bg-muted flex items-center justify-center">
            <Package size={28} className="text-muted-foreground/40" />
          </div>
        )}

        {!readOnly && (
          <div className={`absolute top-2 left-2 z-10 ${selectionMode ? 'opacity-100' : 'opacity-0 [@media(hover:none)]:opacity-40 group-hover/card:opacity-100'} transition-opacity`}>
            <SelectionCheckbox
              checked={isSelected}
              onClick={(e) => { e.stopPropagation(); onToggleSelect(product.id) }}
            />
          </div>
        )}
        <span className={`absolute top-2 right-2 z-10 text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badge}`}>
          {config.label}
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1.5 p-3 flex-1">
        <div className="flex items-center gap-2">
          <h3
            className="flex-1 min-w-0 font-semibold text-heading text-sm leading-tight truncate"
            title={product.name}
          >
            {product.name}
          </h3>
          {!readOnly ? (
            <button
              type="button"
              role="switch"
              aria-checked={inCatalog}
              aria-label={inCatalog ? `Ocultar ${product.name} del catálogo online` : `Mostrar ${product.name} en el catálogo online`}
              title={inCatalog ? 'En el catálogo online' : 'Fuera del catálogo online'}
              onClick={() => onToggleCatalog(product)}
              disabled={loading}
              className="shrink-0 flex items-center gap-1 disabled:opacity-50 touch-manipulation"
            >
              <Globe size={12} className={inCatalog ? 'text-primary' : 'text-hint'} />
              <span className={`relative w-8 h-[18px] rounded-full transition-colors ${inCatalog ? 'bg-primary' : 'bg-input'}`}>
                <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-card shadow-sm transition-transform ${inCatalog ? 'translate-x-3.5' : 'translate-x-0'}`} />
              </span>
            </button>
          ) : (
            inCatalog && <Globe size={13} className="shrink-0 text-primary" aria-label="En el catálogo online" />
          )}
        </div>

        {/* Brand (left) · Category (right) — each segment quick-editable */}
        <div className="flex items-center justify-between gap-2 text-caption text-hint">
          <span
            className={`inline-flex items-center gap-0.5 min-w-0 rounded px-0.5 -mx-0.5 touch-manipulation ${!readOnly ? 'cursor-pointer hover:text-body' : ''}`}
            onClick={!readOnly ? () => onQuickBrand(product) : undefined}
          >
            <span className="truncate">{product.brand?.name ?? 'Sin marca'}</span>
            {!readOnly && <Pencil size={9} className="shrink-0 text-primary opacity-0 group-hover/card:opacity-50 transition-opacity" />}
          </span>
          <span
            className={`inline-flex items-center gap-0.5 min-w-0 rounded px-0.5 -mx-0.5 touch-manipulation ${!readOnly ? 'cursor-pointer hover:text-body' : ''}`}
            onClick={!readOnly ? () => onQuickCategory(product) : undefined}
          >
            {!readOnly && <Pencil size={9} className="shrink-0 text-primary opacity-0 group-hover/card:opacity-50 transition-opacity" />}
            <span className="truncate">{product.categories?.name ?? 'Sin categoría'}</span>
          </span>
        </div>

        {/* Price + stock */}
        <div className="flex items-end justify-between gap-2 mt-0.5">
          <span className="text-emphasis text-heading">
            {formatMoney(Number(product.price))}
          </span>
          {product.has_variants ? (
            <button
              type="button"
              onClick={() => onViewStock(product.id)}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 dark:bg-primary/20 text-primary border border-primary/20 dark:border-primary/40 hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors cursor-pointer touch-manipulation"
              aria-label={`Ver stock de variantes de ${product.name}`}
            >
              {product.variant_count ?? '?'} variantes
            </button>
          ) : (
            <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${stockColor}`}>
              {product.stock} <span className="text-xs font-normal text-hint">uds</span>
            </span>
          )}
        </div>

        {/* Secondary metrics */}
        <p className="text-caption text-hint truncate">
          costo {formatMoney(Number(product.cost))}
          {margin > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-medium"> · +{margin}%</span>}
          {!product.has_variants && ` · min ${product.min_stock}`}
        </p>

        {/* Actions */}
        {!readOnly && (
          <div className="flex items-stretch gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => onEdit(product)}
              disabled={loading}
              className="flex-1 text-xs py-2 rounded-lg border border-edge text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 touch-manipulation"
            >
              Editar
            </button>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={loading}
                  aria-label="Más acciones"
                  className="shrink-0 px-2 rounded-lg border border-edge text-subtle hover:bg-hover-bg hover:text-body transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 touch-manipulation"
                >
                  <MoreVertical size={16} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1 gap-0.5" onClick={() => setMenuOpen(false)}>
                <button
                  type="button"
                  onClick={() => onToggleActive(product)}
                  disabled={loading}
                  className="w-full text-left text-sm px-2.5 py-2 rounded-md text-body hover:bg-hover-bg transition-colors disabled:opacity-50 touch-manipulation"
                >
                  {product.is_active ? 'Discontinuar' : 'Activar'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(product)}
                  disabled={loading}
                  className="w-full text-left text-sm px-2.5 py-2 rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 touch-manipulation"
                >
                  Eliminar
                </button>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </article>
  )
})

export default ProductCard
