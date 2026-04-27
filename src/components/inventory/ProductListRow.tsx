import Image from 'next/image'
import { memo } from 'react'
import { Package, Pencil } from 'lucide-react'
import { TableCell, TableRow } from '@/components/ui/table'
import type { ProductCardProps } from '@/components/inventory/types'
import { getStatus, statusConfig } from '@/components/inventory/types'
import { SelectionCheckbox } from '@/components/inventory/ProductCard'
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
  onDelete,
  onQuickCategory,
  onQuickBrand,
}: ProductCardProps) {
  const formatMoney = useFormatMoney()
  const status = getStatus(product)
  const config = statusConfig[status]
  const margin = product.cost > 0 && product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0

  return (
    <TableRow className={`group/row ${isSelected ? 'bg-primary/5' : ''}`}>
      <TableCell className={`w-10 ${selectionMode ? '' : '[@media(hover:none)]:opacity-40 opacity-0 group-hover/row:opacity-100'} transition-opacity`}>
        <SelectionCheckbox
          checked={isSelected}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(product.id) }}
        />
      </TableCell>
      <TableCell>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${config.badge}`}>
          {config.label}
        </span>
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
                unoptimized={product.image_source === 'url'}
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Package size={20} className="text-muted-foreground/40" />
            </div>
          )}
          <div>
            <p className="font-semibold text-sm text-heading">{product.name}</p>
            <p className="text-xs text-subtle xl:hidden">
              {product.categories?.name ?? '—'} · {product.brand?.name ?? '—'}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        <div
          className={`group/cat flex items-center gap-1 min-w-0 rounded px-1 -mx-1 touch-manipulation ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickCategory(product) : undefined}
        >
          <p className="text-sm text-subtle truncate">{product.categories?.name ?? '—'}</p>
          {!readOnly && (
            <Pencil size={11} className="shrink-0 text-primary opacity-40 [@media(hover:hover)]:opacity-0 group-hover/cat:opacity-60 transition-opacity" />
          )}
        </div>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        <div
          className={`group/brand flex items-center gap-1 min-w-0 rounded px-1 -mx-1 touch-manipulation ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickBrand(product) : undefined}
        >
          <p className="text-sm text-subtle truncate">{product.brand?.name ?? '—'}</p>
          {!readOnly && (
            <Pencil size={11} className="shrink-0 text-primary opacity-40 [@media(hover:hover)]:opacity-0 group-hover/brand:opacity-60 transition-opacity" />
          )}
        </div>
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
        <p className="text-sm font-semibold text-heading tabular-nums">{product.stock} <span className="text-xs font-normal text-hint">uds</span></p>
        <p className="text-xs text-hint">min. {product.min_stock}</p>
      </TableCell>

      {!readOnly && (
        <TableCell>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(product)}
              disabled={loadingId === product.id}
              className="text-xs px-3 py-2 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50 touch-manipulation"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => onToggleActive(product)}
              disabled={loadingId === product.id}
              className="text-xs px-3 py-2 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50 touch-manipulation"
            >
              {product.is_active ? 'Discontinuar' : 'Activar'}
            </button>
            <button
              type="button"
              onClick={() => onDelete(product)}
              disabled={loadingId === product.id}
              className="text-xs px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50 touch-manipulation"
            >
              Eliminar
            </button>
          </div>
        </TableCell>
      )}
    </TableRow>
  )
})

export default ProductListRow
