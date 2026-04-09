import Image from 'next/image'
import { memo } from 'react'
import { Package, Pencil } from 'lucide-react'
import type { ProductCardProps, InventoryProduct } from '@/components/inventory/types'
import { getStatus, statusConfig } from '@/components/inventory/types'

export function SelectionCheckbox({ checked, onClick }: { checked: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-0.5"
    >
      <span className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
        checked ? 'bg-primary border-primary' : 'border-edge bg-surface'
      }`}>
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
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
  onDelete,
  onQuickCategory,
  onQuickBrand,
}: ProductCardProps) {
  const status = getStatus(product)
  const config = statusConfig[status]
  const margin = product.cost > 0 && product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0

  return (
    <article
      className={`rounded-[20px] border-2 ${isSelected ? 'border-primary' : 'border-edge/30'} ${config.hoverBorder} bg-surface p-4 flex flex-col relative transition-all hover:shadow-md overflow-hidden group/card`}
    >
      <div className={`absolute top-3 left-3 z-10 ${selectionMode ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'} transition-opacity`}>
        <SelectionCheckbox
          checked={isSelected}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(product.id) }}
        />
      </div>
      <span className={`absolute top-3 right-3 z-10 text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badge}`}>
        {config.label}
      </span>

      {product.image_url ? (
        <div className="relative -mx-4 -mt-4 mb-3 aspect-square">
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            className="object-cover"
            unoptimized={product.image_source === 'url'}
          />
        </div>
      ) : (
        <div className="-mx-4 -mt-4 mb-3 aspect-square bg-muted flex items-center justify-center">
          <Package size={32} className="text-muted-foreground/40" />
        </div>
      )}

      <h3
        className="font-semibold text-heading text-sm leading-tight mb-2 truncate pr-16"
        title={product.name}
      >
        {product.name}
      </h3>

      <div className="flex flex-col gap-0.5 mb-3">
        <div
          className={`group/catfield flex items-center gap-1 min-w-0 rounded px-1 -mx-1 ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickCategory(product) : undefined}
        >
          <p className="text-xs text-subtle truncate flex-1 min-w-0">
            <span className="text-hint">Cat:</span> {product.categories?.name ?? '—'}
          </p>
          {!readOnly && (
            <Pencil size={9} className="shrink-0 text-primary opacity-0 group-hover/catfield:opacity-50 transition-opacity" />
          )}
        </div>
        <div
          className={`group/brandfield flex items-center gap-1 min-w-0 rounded px-1 -mx-1 ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickBrand(product) : undefined}
        >
          <p className="text-xs text-subtle truncate flex-1 min-w-0">
            <span className="text-hint">Marca:</span> {product.brand?.name ?? '—'}
          </p>
          {!readOnly && (
            <Pencil size={9} className="shrink-0 text-primary opacity-0 group-hover/brandfield:opacity-50 transition-opacity" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg bg-surface-alt px-2 py-1.5">
          <p className="text-label text-hint">Venta</p>
          <p className="text-emphasis text-heading">
            ${Number(product.price).toLocaleString('es-AR')}
          </p>
        </div>
        <div className="rounded-lg bg-surface-alt px-2 py-1.5">
          <p className="text-label text-hint">Costo</p>
          <p className="text-body-sm text-subtle">
            ${Number(product.cost).toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-3">
        <span className="text-emphasis text-heading">
          {product.stock} <span className="text-xs font-normal text-hint">uds</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-hint">min. {product.min_stock}</span>
          <span className={`text-[10px] font-semibold ${margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'invisible'}`}>
            +{margin}%
          </span>
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-col gap-1.5 mt-auto">
          <button
            onClick={() => onEdit(product)}
            disabled={loadingId === product.id}
            className="w-full text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
          >
            Editar
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onToggleActive(product)}
              disabled={loadingId === product.id}
              className="text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
            >
              {product.is_active ? 'Baja' : 'Activar'}
            </button>
            <button
              onClick={() => onDelete(product)}
              disabled={loadingId === product.id}
              className="text-xs py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}
    </article>
  )
})

export default ProductCard
