'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface ProductFilterValue {
  search: string
  categoryId: string | null
  brandId: string | null
  // TODO: variant-attributes filter
  // TODO: price-range filter
  // TODO: stock-status filter
  // TODO: sort
}

export const EMPTY_FILTER: ProductFilterValue = {
  search: '',
  categoryId: null,
  brandId: null,
}

// ─── Module types ─────────────────────────────────────────────────────────────

export type FilterModule =
  | 'search'
  | 'category'
  | 'brand'
  | 'variant-attributes' // TODO: implement in next prompt
  | 'price-range'        // TODO: implement in next prompt
  | 'stock-status'       // TODO: implement in next prompt
  | 'sort'               // TODO: implement in next prompt

// ─── Options data ─────────────────────────────────────────────────────────────

export interface FilterCategory {
  id: string
  name: string
  icon?: string
}

export interface FilterBrand {
  id: string
  name: string
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  modules: FilterModule[]
  layout: 'topbar' | 'sidebar'
  value: ProductFilterValue
  onChange: (next: ProductFilterValue) => void
  categories?: FilterCategory[]
  brands?: FilterBrand[]
}

export default function ProductFilter({
  modules,
  layout,
  value,
  onChange,
  categories = [],
  brands = [],
}: Props) {
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)

  const filteredCategories = useMemo(() => {
    return categories.filter(c => c.id !== value.categoryId)
  }, [categories, value.categoryId])

  const filteredBrands = useMemo(() => {
    return brands.filter(b => b.id !== value.brandId)
  }, [brands, value.brandId])

  const activeCategory = categories.find(c => c.id === value.categoryId)
  const activeBrand = brands.find(b => b.id === value.brandId)

  const containerClass = layout === 'sidebar'
    ? 'flex flex-col gap-3'
    : 'flex items-center gap-2 flex-wrap'

  return (
    <div className={containerClass}>
      {/* Search module */}
      {modules.includes('search') && (
        <Input
          value={value.search}
          onChange={e => onChange({ ...value, search: e.target.value })}
          placeholder="Buscar producto…"
          className="h-9 text-sm rounded-lg bg-surface border-edge focus-visible:ring-ring/50"
        />
      )}

      {/* Category module */}
      {modules.includes('category') && categories.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setCategoryOpen(v => !v)}
            className={[
              'h-9 px-3 rounded-lg border text-sm transition-colors',
              activeCategory
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-surface border-edge text-body hover:bg-hover-bg',
            ].join(' ')}
          >
            {activeCategory ? `${activeCategory.icon ?? ''} ${activeCategory.name}` : 'Categoría'}
          </button>
          {categoryOpen && (
            <div className="absolute top-full left-0 mt-1 z-20 surface-elevated rounded-lg overflow-hidden min-w-[180px]">
              <button
                type="button"
                className="w-full px-3 py-2 text-sm text-left text-body hover:bg-hover-bg transition-colors"
                onClick={() => { onChange({ ...value, categoryId: null }); setCategoryOpen(false) }}
              >
                Todas las categorías
              </button>
              {filteredCategories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  className="w-full px-3 py-2 text-sm text-left text-body hover:bg-hover-bg transition-colors"
                  onClick={() => { onChange({ ...value, categoryId: cat.id }); setCategoryOpen(false) }}
                >
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Brand module */}
      {modules.includes('brand') && brands.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setBrandOpen(v => !v)}
            className={[
              'h-9 px-3 rounded-lg border text-sm transition-colors',
              activeBrand
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-surface border-edge text-body hover:bg-hover-bg',
            ].join(' ')}
          >
            {activeBrand ? activeBrand.name : 'Marca'}
          </button>
          {brandOpen && (
            <div className="absolute top-full left-0 mt-1 z-20 surface-elevated rounded-lg overflow-hidden min-w-[160px]">
              <button
                type="button"
                className="w-full px-3 py-2 text-sm text-left text-body hover:bg-hover-bg transition-colors"
                onClick={() => { onChange({ ...value, brandId: null }); setBrandOpen(false) }}
              >
                Todas las marcas
              </button>
              {filteredBrands.map(brand => (
                <button
                  key={brand.id}
                  type="button"
                  className="w-full px-3 py-2 text-sm text-left text-body hover:bg-hover-bg transition-colors"
                  onClick={() => { onChange({ ...value, brandId: brand.id }); setBrandOpen(false) }}
                >
                  {brand.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TODO: variant-attributes module */}
      {/* TODO: price-range module */}
      {/* TODO: stock-status module */}
      {/* TODO: sort module */}
    </div>
  )
}
