'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { InventoryBrand, InventoryCategory, SortOption } from '@/components/inventory/types'

const SORT_OPTIONS: { field: SortOption['field']; label: string }[] = [
  { field: 'name',   label: 'Nombre' },
  { field: 'price',  label: 'Precio de venta' },
  { field: 'cost',   label: 'Costo' },
  { field: 'stock',  label: 'Stock' },
  { field: 'margin', label: 'Margen' },
]

interface Props {
  open: boolean
  onClose: () => void
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  selectedCategories: string[]
  selectedBrands: string[]
  onCategoriesChange: (ids: string[]) => void
  onBrandsChange: (ids: string[]) => void
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  showInCatalogOnly: boolean
  onShowInCatalogChange: (val: boolean) => void
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
      checked ? 'bg-primary border-primary' : 'border-edge'
    }`}>
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

interface SectionProps {
  label: string
  badge?: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Section({ label, badge, open, onToggle, children }: SectionProps) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-label text-hint">{label}</span>
          {badge != null && badge > 0 && (
            <span className="text-xs font-bold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-hint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div>{children}</div>}
    </section>
  )
}

export default function FilterSidebar({
  open,
  onClose,
  categories,
  brands,
  selectedCategories,
  selectedBrands,
  onCategoriesChange,
  onBrandsChange,
  sort,
  onSortChange,
  showInCatalogOnly,
  onShowInCatalogChange,
}: Props) {
  const [catQuery, setCatQuery] = useState('')
  const [brandQuery, setBrandQuery] = useState('')
  const [openSections, setOpenSections] = useState({
    sort: true,
    visibility: true,
    categories: true,
    brands: true,
  })

  function toggleSection(key: keyof typeof openSections) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const filteredCats = catQuery.trim()
    ? categories.filter(c => c.name.toLowerCase().includes(catQuery.trim().toLowerCase()))
    : categories

  const filteredBrands = brandQuery.trim()
    ? brands.filter(b => b.name.toLowerCase().includes(brandQuery.trim().toLowerCase()))
    : brands

  const activeCount = selectedCategories.length + selectedBrands.length + (showInCatalogOnly ? 1 : 0)

  function toggleCategory(id: string) {
    if (selectedCategories.includes(id)) {
      onCategoriesChange(selectedCategories.filter(c => c !== id))
    } else {
      onCategoriesChange([...selectedCategories, id])
    }
  }

  function toggleBrand(id: string) {
    if (selectedBrands.includes(id)) {
      onBrandsChange(selectedBrands.filter(b => b !== id))
    } else {
      onBrandsChange([...selectedBrands, id])
    }
  }

  function clearAll() {
    onCategoriesChange([])
    onBrandsChange([])
    onShowInCatalogChange(false)
  }

  function handleSort(field: SortOption['field']) {
    if (sort.field === field) {
      onSortChange({ field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    } else {
      onSortChange({ field, dir: 'asc' })
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-foreground/30 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-72 bg-card border-l border-edge flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ boxShadow: '-4px 0 32px rgba(0, 0, 0, 0.10)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-subtle" />
            <span className="font-semibold text-sm text-heading">Filtros</span>
            {activeCount > 0 && (
              <span className="text-xs font-bold bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">
                {activeCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-subtle hover:text-body transition-colors rounded-lg p-1 hover:bg-hover-bg"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Sort */}
          <Section
            label="Ordenar por"
            open={openSections.sort}
            onToggle={() => toggleSection('sort')}
          >
            <div className="space-y-0.5">
              {SORT_OPTIONS.map(({ field, label }) => {
                const isActive = sort.field === field
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => handleSort(field)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      isActive ? 'bg-primary/10 text-primary font-medium' : 'text-body hover:bg-hover-bg'
                    }`}
                  >
                    <span>{label}</span>
                    {isActive && (
                      sort.dir === 'asc'
                        ? <ArrowUp size={14} />
                        : <ArrowDown size={14} />
                    )}
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Catalog visibility */}
          <Section
            label="Visibilidad"
            badge={showInCatalogOnly ? 1 : 0}
            open={openSections.visibility}
            onToggle={() => toggleSection('visibility')}
          >
            <button
              type="button"
              onClick={() => onShowInCatalogChange(!showInCatalogOnly)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                showInCatalogOnly ? 'bg-primary/10 text-primary font-medium' : 'text-body hover:bg-hover-bg'
              }`}
            >
              <Checkbox checked={showInCatalogOnly} />
              <span>Solo visibles en catálogo</span>
            </button>
          </Section>

          {/* Categories */}
          {categories.length > 0 && (
            <Section
              label="Categorías"
              badge={selectedCategories.length}
              open={openSections.categories}
              onToggle={() => toggleSection('categories')}
            >
              <div className="relative mb-2">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
                <input
                  type="text"
                  value={catQuery}
                  onChange={e => setCatQuery(e.target.value)}
                  placeholder="Buscar categoría..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-edge bg-surface-alt text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
              <div className="space-y-0.5">
                {filteredCats.length === 0 ? (
                  <p className="text-xs text-hint px-3 py-2">Sin resultados</p>
                ) : filteredCats.map(cat => {
                  const checked = selectedCategories.includes(cat.id)
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                        checked ? 'bg-primary/10 text-primary font-medium' : 'text-body hover:bg-hover-bg'
                      }`}
                    >
                      <Checkbox checked={checked} />
                      <span className="truncate">{cat.icon} {cat.name}</span>
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Brands */}
          {brands.length > 0 && (
            <Section
              label="Marcas"
              badge={selectedBrands.length}
              open={openSections.brands}
              onToggle={() => toggleSection('brands')}
            >
              <div className="relative mb-2">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
                <input
                  type="text"
                  value={brandQuery}
                  onChange={e => setBrandQuery(e.target.value)}
                  placeholder="Buscar marca..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-edge bg-surface-alt text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
              <div className="space-y-0.5">
                {filteredBrands.length === 0 ? (
                  <p className="text-xs text-hint px-3 py-2">Sin resultados</p>
                ) : filteredBrands.map(brand => {
                  const checked = selectedBrands.includes(brand.id)
                  return (
                    <button
                      key={brand.id}
                      type="button"
                      onClick={() => toggleBrand(brand.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                        checked ? 'bg-primary/10 text-primary font-medium' : 'text-body hover:bg-hover-bg'
                      }`}
                    >
                      <Checkbox checked={checked} />
                      <span className="truncate">{brand.name}</span>
                    </button>
                  )
                })}
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        {activeCount > 0 && (
          <div className="px-5 py-4 border-t border-edge shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-lg text-xs"
              onClick={clearAll}
            >
              Limpiar filtros ({activeCount})
            </Button>
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
