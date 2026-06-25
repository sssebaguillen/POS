import { createPortal } from 'react-dom'
import { X, FadersHorizontal as FilterIcon } from '@phosphor-icons/react/dist/ssr'
import ProductFilter, { type ProductFilterValue } from '@/components/shared/ProductFilter'
import type { InventoryBrand, InventoryCategory } from '@/components/inventory/types'

interface Props {
  open: boolean
  onClose: () => void
  activeFilterCount: number
  value: ProductFilterValue
  onChange: (value: ProductFilterValue) => void
  categories: InventoryCategory[]
  brands: InventoryBrand[]
}

/**
 * Drawer lateral de filtros del inventario (overlay + panel en portal con ProductFilter).
 * Presentacional pura — extraído de InventoryPanel sin cambiar el markup, la animación
 * ni las opciones; el padre controla open/onClose y posee filterValue. Behavior-preserving.
 */
export default function InventoryFilterDrawer({
  open,
  onClose,
  activeFilterCount,
  value,
  onChange,
  categories,
  brands,
}: Props) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-72 bg-card border-l border-edge flex flex-col transition-transform duration-200 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ boxShadow: '-4px 0 32px rgba(0,0,0,0.10)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <FilterIcon size={16} className="text-subtle" />
            <span className="font-semibold text-sm text-heading">Filtros</span>
            {activeFilterCount > 0 && (
              <span className="text-xs font-bold bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-subtle hover:text-body transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 rounded-lg p-1 hover:bg-hover-bg"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ProductFilter
            modules={['category', 'brand', 'price-range', 'stock-status', 'sort']}
            layout="sidebar"
            value={value}
            onChange={onChange}
            categories={categories.map(c => ({ id: c.id, name: c.name, icon: c.icon, icon_color: c.icon_color }))}
            brands={brands.map(b => ({ id: b.id, name: b.name }))}
            sortOptions={[
              { field: 'name', label: 'Nombre' },
              { field: 'price', label: 'Precio de venta' },
              { field: 'cost', label: 'Costo' },
              { field: 'stock', label: 'Stock' },
              { field: 'margin', label: 'Margen' },
            ]}
            stockStatusOptions={[
              { value: 'all', label: 'Todos' },
              { value: 'low-stock', label: 'Stock bajo' },
              { value: 'out-of-stock', label: 'Sin stock' },
              { value: 'discontinued', label: 'Discontinuados' },
              { value: 'catalog-only', label: 'Solo en catálogo' },
            ]}
          />
        </div>
      </div>
    </>,
    document.body
  )
}
