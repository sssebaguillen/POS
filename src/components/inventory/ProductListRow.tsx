'use client'

import Image from 'next/image'
import { memo, useState } from 'react'
import { Package, Pencil, MoreVertical } from 'lucide-react'
import { TableCell, TableRow } from '@/components/ui/table'
import type { ProductCardProps } from '@/components/inventory/types'
import { SelectionCheckbox } from '@/components/inventory/ProductCard'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

const ProductListRow = memo(function ProductListRow({
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
  const margin = product.cost > 0 && product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0
  const loading = loadingId === product.id

  // Stock health is independent of the active/discontinued lifecycle — it lives on
  // the Stock column, while is_active lives on the Estado toggle.
  const stockColor = product.has_variants
    ? 'text-heading'
    : product.stock <= 0
      ? 'text-destructive'
      : product.stock <= product.min_stock
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-heading'

  return (
    <TableRow className={`group/row ${isSelected ? 'bg-primary/5' : ''} ${!product.is_active ? 'opacity-60' : ''}`}>
      <TableCell className={`w-10 ${selectionMode ? '' : '[@media(hover:none)]:opacity-40 opacity-0 group-hover/row:opacity-100'} transition-opacity`}>
        {!readOnly && (
          <SelectionCheckbox
            checked={isSelected}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(product.id) }}
          />
        )}
      </TableCell>

      <TableCell className="text-center">
        <button
          type="button"
          role="switch"
          aria-checked={inCatalog}
          aria-label={inCatalog ? `Ocultar ${product.name} del catálogo online` : `Mostrar ${product.name} en el catálogo online`}
          onClick={readOnly ? undefined : () => onToggleCatalog(product)}
          disabled={readOnly || loading}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${inCatalog ? 'bg-primary' : 'bg-input'} ${readOnly ? 'cursor-default' : 'cursor-pointer'} disabled:opacity-50`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${inCatalog ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-3">
          {product.image_url ? (
            <div className="relative w-12 h-12 rounded-md overflow-hidden shrink-0">
              <Image
                src={product.image_url}
                alt={product.name}
                fill
                sizes="48px"
                className="object-cover"
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Package size={20} className="text-muted-foreground/40" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm text-heading truncate">{product.name}</p>
              {!product.is_active && (
                <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Discontinuado
                </span>
              )}
            </div>
            <p className="text-xs text-subtle xl:hidden">
              {product.categories?.name ?? '—'} · {product.brand?.name ?? '—'}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        <span
          className={`group/cat inline-flex items-center gap-1 min-w-0 touch-manipulation ${!readOnly ? 'cursor-pointer' : ''}`}
          onClick={!readOnly ? () => onQuickCategory(product) : undefined}
        >
          <span className="text-sm text-subtle truncate transition-colors group-hover/cat:text-heading">{product.categories?.name ?? '—'}</span>
          {!readOnly && (
            <Pencil size={11} className="shrink-0 text-primary opacity-0 [@media(hover:none)]:opacity-50 group-hover/cat:opacity-100 transition-opacity" />
          )}
        </span>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        <span
          className={`group/brand inline-flex items-center gap-1 min-w-0 touch-manipulation ${!readOnly ? 'cursor-pointer' : ''}`}
          onClick={!readOnly ? () => onQuickBrand(product) : undefined}
        >
          <span className="text-sm text-subtle truncate transition-colors group-hover/brand:text-heading">{product.brand?.name ?? '—'}</span>
          {!readOnly && (
            <Pencil size={11} className="shrink-0 text-primary opacity-0 [@media(hover:none)]:opacity-50 group-hover/brand:opacity-100 transition-opacity" />
          )}
        </span>
      </TableCell>

      <TableCell className="text-right hidden md:table-cell">
        <p className="text-sm font-semibold text-heading tabular-nums">{formatMoney(Number(product.price))}</p>
      </TableCell>

      <TableCell className="text-right hidden lg:table-cell">
        <p className="text-sm text-subtle tabular-nums">{formatMoney(Number(product.cost))}</p>
      </TableCell>

      <TableCell className="text-right hidden lg:table-cell">
        <span className={`text-sm font-semibold ${margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-hint'}`}>
          {margin > 0 ? `+${margin}%` : '—'}
        </span>
      </TableCell>

      <TableCell className="text-right">
        {product.has_variants ? (
          <button
            type="button"
            onClick={() => onViewStock(product.id)}
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 dark:bg-primary/20 text-primary border border-primary/20 dark:border-primary/40 whitespace-nowrap hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors cursor-pointer touch-manipulation"
            aria-label={`Ver stock de variantes de ${product.name}`}
          >
            {product.variant_count ?? '?'} variantes
          </button>
        ) : (
          <>
            <p className={`text-sm font-semibold tabular-nums ${stockColor}`}>{product.stock} <span className="text-xs font-normal text-hint">uds</span></p>
            <p className="text-xs text-hint">min. {product.min_stock}</p>
          </>
        )}
      </TableCell>

      {!readOnly && (
        <TableCell>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(product)}
              disabled={loading}
              className="text-xs px-3 py-2 rounded-lg border border-edge text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 touch-manipulation"
            >
              Editar
            </button>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={loading}
                  aria-label="Más acciones"
                  className="shrink-0 px-2 py-2 rounded-lg border border-edge text-subtle hover:bg-hover-bg hover:text-body transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 touch-manipulation"
                >
                  <MoreVertical size={16} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1 gap-0.5" onClick={() => setMenuOpen(false)}>
                <button
                  type="button"
                  onClick={() => onToggleActive(product)}
                  disabled={loading}
                  className="w-full text-left text-sm px-2.5 py-2 rounded-md text-body hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-50 touch-manipulation"
                >
                  {product.is_active ? 'Discontinuar' : 'Activar'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(product)}
                  disabled={loading}
                  className="w-full text-left text-sm px-2.5 py-2 rounded-md text-destructive hover:bg-destructive/10 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-50 touch-manipulation"
                >
                  Eliminar
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </TableCell>
      )}
    </TableRow>
  )
})

export default ProductListRow
