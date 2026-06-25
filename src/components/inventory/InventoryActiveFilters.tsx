import { X } from '@phosphor-icons/react/dist/ssr'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'
import type { InventoryBrand, InventoryCategory } from '@/components/inventory/types'

interface Props {
  selectedCategories: string[]
  selectedBrands: string[]
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  onRemoveCategory: (id: string) => void
  onRemoveBrand: (id: string) => void
  onClearAll: () => void
}

/**
 * Fila de chips removibles de los filtros activos (categorías + marcas) + "Limpiar todo".
 * Presentacional pura — extraída de InventoryPanel sin cambiar el markup ni el
 * comportamiento (los callbacks reproducen exactamente los setFilterValue inline).
 * Behavior-preserving. El padre sigue controlando cuándo renderizarla.
 */
export default function InventoryActiveFilters({
  selectedCategories,
  selectedBrands,
  categories,
  brands,
  onRemoveCategory,
  onRemoveBrand,
  onClearAll,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 bg-surface border-b border-edge/60">
      {selectedCategories.map(id => {
        const cat = categories.find(c => c.id === id)
        if (!cat) return null
        return (
          <span key={id} className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary rounded-full px-2.5 py-1 font-medium">
            <CategoryIconPreview icon={cat.icon} color={cat.icon_color ?? 'var(--primary)'} size={12} />
            {cat.name}
            <button
              type="button"
              onClick={() => onRemoveCategory(id)}
              aria-label={`Quitar categoría ${cat.name}`}
              className="hover:opacity-70 transition-[transform,opacity] duration-150 ease-[var(--ease-out)] active:scale-95 p-0.5 -m-0.5 touch-manipulation"
            >
              <X size={11} />
            </button>
          </span>
        )
      })}
      {selectedBrands.map(id => {
        const brand = brands.find(b => b.id === id)
        if (!brand) return null
        return (
          <span key={id} className="flex items-center gap-1.5 text-xs bg-surface-alt text-body border border-edge rounded-full px-2.5 py-1 font-medium">
            {brand.name}
            <button
              type="button"
              onClick={() => onRemoveBrand(id)}
              aria-label={`Quitar marca ${brand.name}`}
              className="hover:opacity-70 transition-[transform,opacity] duration-150 ease-[var(--ease-out)] active:scale-95 p-0.5 -m-0.5 touch-manipulation"
            >
              <X size={11} />
            </button>
          </span>
        )
      })}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-subtle hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
      >
        Limpiar todo
      </button>
    </div>
  )
}
