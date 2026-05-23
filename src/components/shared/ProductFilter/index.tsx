'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface ProductFilterValue {
  search: string
  categoryIds: string[]
  brandIds: string[]
  variantAttributes: Record<string, string[]>  // typeId → selected values (OR within, AND across)
  priceMin: string
  priceMax: string
  stockStatus: string  // 'all' + caller-defined values
  sortField: string
  sortDir: 'asc' | 'desc'
  showInCatalogOnly: boolean
}

export const EMPTY_FILTER: ProductFilterValue = {
  search: '',
  categoryIds: [],
  brandIds: [],
  variantAttributes: {},
  priceMin: '',
  priceMax: '',
  stockStatus: 'all',
  sortField: 'name',
  sortDir: 'asc',
  showInCatalogOnly: false,
}

export function countActiveFilters(v: ProductFilterValue): number {
  return (
    v.categoryIds.length +
    v.brandIds.length +
    Object.values(v.variantAttributes).flat().length +
    (v.priceMin || v.priceMax ? 1 : 0) +
    (v.stockStatus !== 'all' ? 1 : 0) +
    (v.showInCatalogOnly ? 1 : 0)
  )
}

// ─── Module types ─────────────────────────────────────────────────────────────

export type FilterModule =
  | 'search'
  | 'category'
  | 'brand'
  | 'variant-attributes'
  | 'price-range'
  | 'stock-status'
  | 'sort'

// ─── Options data ─────────────────────────────────────────────────────────────

export interface FilterCategory {
  id: string
  name: string
  icon?: string
  icon_color?: string
}

export interface FilterBrand {
  id: string
  name: string
}

export interface VariantAttributeGroup {
  typeId: string
  typeName: string
  values: { value: string; productIds: string[] }[]
}

export interface SortOption {
  field: string
  label: string
}

export interface StockStatusOption {
  value: string
  label: string
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  modules: FilterModule[]
  layout: 'topbar' | 'sidebar'
  value: ProductFilterValue
  onChange: (next: ProductFilterValue) => void
  categories?: FilterCategory[]
  brands?: FilterBrand[]
  variantAttributeGroups?: VariantAttributeGroup[]
  sortOptions?: SortOption[]
  stockStatusOptions?: StockStatusOption[]
}

// ─── Internal helpers ────────────────────────────────────────────────────────

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

// ─── Topbar layout ────────────────────────────────────────────────────────────

function TopbarLayout({
  modules,
  value,
  onChange,
  categories,
  brands,
}: {
  modules: FilterModule[]
  value: ProductFilterValue
  onChange: (next: ProductFilterValue) => void
  categories: FilterCategory[]
  brands: FilterBrand[]
}) {
  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted border-transparent'
    }`

  function toggleCategory(id: string) {
    const active = value.categoryIds.includes(id)
    // Single-select for topbar: clicking same clears, clicking different replaces
    onChange({ ...value, categoryIds: active ? [] : [id] })
  }

  function toggleBrand(id: string) {
    const active = value.brandIds.includes(id)
    onChange({ ...value, brandIds: active ? [] : [id] })
  }

  return (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {modules.includes('search') && (
        <Input
          value={value.search}
          onChange={e => onChange({ ...value, search: e.target.value })}
          placeholder="Buscar producto..."
          className="h-9 max-w-xs text-sm rounded-lg bg-surface border-edge focus-visible:ring-ring/50 shrink-0"
        />
      )}

      {modules.includes('category') && categories.length > 0 && (
        <>
          
          <button
            type="button"
            onClick={e => { onChange({ ...value, categoryIds: [] }); e.currentTarget.blur() }}
            className={chip(value.categoryIds.length === 0)}
          >
            Todos
          </button>
          <span className="shrink-0 w-px h-5 bg-edge/60" />
          {categories.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={e => { toggleCategory(cat.id); e.currentTarget.blur() }}
              className={chip(value.categoryIds.includes(cat.id))}
            >
              <span className="flex items-center gap-1.5">
                {cat.icon && <CategoryIconPreview icon={cat.icon} color={cat.icon_color ?? 'var(--primary)'} size={14} />}
                {cat.name}
              </span>
            </button>
          ))}
        </>
      )}

      {modules.includes('brand') && brands.length > 0 && (
        <>
          <span className="shrink-0 w-px h-5 bg-edge/60" />
          {brands.map(brand => (
            <button
              key={brand.id}
              type="button"
              onClick={e => { toggleBrand(brand.id); e.currentTarget.blur() }}
              className={chip(value.brandIds.includes(brand.id))}
            >
              {brand.name}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

// ─── Sidebar layout ───────────────────────────────────────────────────────────

function SidebarLayout({
  modules,
  value,
  onChange,
  categories,
  brands,
  variantAttributeGroups,
  sortOptions,
  stockStatusOptions,
}: {
  modules: FilterModule[]
  value: ProductFilterValue
  onChange: (next: ProductFilterValue) => void
  categories: FilterCategory[]
  brands: FilterBrand[]
  variantAttributeGroups: VariantAttributeGroup[]
  sortOptions: SortOption[]
  stockStatusOptions: StockStatusOption[]
}) {
  const [catQuery, setCatQuery] = useState('')
  const [brandQuery, setBrandQuery] = useState('')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    search: true,
    category: true,
    brand: true,
    'variant-attributes': true,
    'price-range': true,
    'stock-status': true,
    sort: true,
  })

  function toggle(key: string) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const filteredCats = catQuery.trim()
    ? categories.filter(c => c.name.toLowerCase().includes(catQuery.toLowerCase()))
    : categories

  const filteredBrands = brandQuery.trim()
    ? brands.filter(b => b.name.toLowerCase().includes(brandQuery.toLowerCase()))
    : brands

  function toggleCategory(id: string) {
    const next = value.categoryIds.includes(id)
      ? value.categoryIds.filter(c => c !== id)
      : [...value.categoryIds, id]
    onChange({ ...value, categoryIds: next })
  }

  function toggleBrand(id: string) {
    const next = value.brandIds.includes(id)
      ? value.brandIds.filter(b => b !== id)
      : [...value.brandIds, id]
    onChange({ ...value, brandIds: next })
  }

  function toggleVariantValue(typeId: string, val: string) {
    const current = value.variantAttributes[typeId] ?? []
    const next = current.includes(val)
      ? current.filter(v => v !== val)
      : [...current, val]
    const nextMap = { ...value.variantAttributes }
    if (next.length === 0) {
      delete nextMap[typeId]
    } else {
      nextMap[typeId] = next
    }
    onChange({ ...value, variantAttributes: nextMap })
  }

  function handleSort(field: string) {
    if (value.sortField === field) {
      onChange({ ...value, sortDir: value.sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      onChange({ ...value, sortField: field, sortDir: 'asc' })
    }
  }

  const totalVariantSelected = Object.values(value.variantAttributes).flat().length

  const activeCount = countActiveFilters(value)

  return (
    <div className="flex flex-col gap-0">
      <div className="space-y-5">
        {/* Search */}
        {modules.includes('search') && (
          <Section label="Buscar" open={openSections.search ?? true} onToggle={() => toggle('search')}>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
              <input
                type="text"
                value={value.search}
                onChange={e => onChange({ ...value, search: e.target.value })}
                placeholder="Nombre, SKU, código..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-edge bg-card text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </Section>
        )}

        {/* Sort */}
        {modules.includes('sort') && sortOptions.length > 0 && (
          <Section label="Ordenar por" open={openSections.sort ?? true} onToggle={() => toggle('sort')}>
            <div className="space-y-0.5">
              {sortOptions.map(opt => {
                const isActive = value.sortField === opt.field
                return (
                  <button
                    key={opt.field}
                    type="button"
                    onClick={() => handleSort(opt.field)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      isActive ? 'bg-primary/10 text-primary font-medium' : 'text-body hover:bg-hover-bg'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isActive && (
                      value.sortDir === 'asc'
                        ? <ArrowUp size={14} />
                        : <ArrowDown size={14} />
                    )}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {/* Stock status */}
        {modules.includes('stock-status') && stockStatusOptions.length > 0 && (
          <Section
            label="Estado"
            badge={value.stockStatus !== 'all' ? 1 : 0}
            open={openSections['stock-status'] ?? true}
            onToggle={() => toggle('stock-status')}
          >
            <div className="space-y-0.5">
              {stockStatusOptions.map(opt => {
                const isActive = value.stockStatus === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ ...value, stockStatus: opt.value })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      isActive ? 'bg-primary/10 text-primary font-medium' : 'text-body hover:bg-hover-bg'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-primary' : 'bg-edge'}`} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {/* Categories */}
        {modules.includes('category') && categories.length > 0 && (
          <Section
            label="Categorías"
            badge={value.categoryIds.length}
            open={openSections.category ?? true}
            onToggle={() => toggle('category')}
          >
            {categories.length > 8 && (
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
            )}
            <div className="space-y-0.5">
              {filteredCats.length === 0 ? (
                <p className="text-xs text-hint px-3 py-2">Sin resultados</p>
              ) : filteredCats.map(cat => {
                const checked = value.categoryIds.includes(cat.id)
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
                    <span className="flex items-center gap-2 truncate">
                      {cat.icon && <CategoryIconPreview icon={cat.icon} color={cat.icon_color ?? 'var(--primary)'} size={15} />}
                      {cat.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {/* Brands */}
        {modules.includes('brand') && brands.length > 0 && (
          <Section
            label="Marcas"
            badge={value.brandIds.length}
            open={openSections.brand ?? true}
            onToggle={() => toggle('brand')}
          >
            {brands.length > 8 && (
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
            )}
            <div className="space-y-0.5">
              {filteredBrands.length === 0 ? (
                <p className="text-xs text-hint px-3 py-2">Sin resultados</p>
              ) : filteredBrands.map(brand => {
                const checked = value.brandIds.includes(brand.id)
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

        {/* Variant attributes */}
        {modules.includes('variant-attributes') && variantAttributeGroups.length > 0 && (
          <Section
            label="Variantes"
            badge={totalVariantSelected}
            open={openSections['variant-attributes'] ?? true}
            onToggle={() => toggle('variant-attributes')}
          >
            <div className="space-y-5">
              {variantAttributeGroups.map(group => {
                const selectedVals = value.variantAttributes[group.typeId] ?? []
                return (
                  <div key={group.typeId} className="space-y-2">
                    <p className="text-xs uppercase text-muted-foreground">
                      {group.typeName}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.values.map(({ value: val }) => {
                        const active = selectedVals.includes(val)
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => toggleVariantValue(group.typeId, val)}
                            className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                              active
                                ? 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/20 dark:border-primary/40'
                                : 'border-edge text-body hover:bg-hover-bg'
                            }`}
                          >
                            {val}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* Price range */}
        {modules.includes('price-range') && (
          <Section
            label="Precio"
            badge={value.priceMin || value.priceMax ? 1 : 0}
            open={openSections['price-range'] ?? true}
            onToggle={() => toggle('price-range')}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={value.priceMin}
                onChange={e => onChange({ ...value, priceMin: e.target.value })}
                placeholder="Mín."
                className="w-full py-1.5 px-3 text-xs rounded-lg border border-edge bg-card text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <span className="text-hint text-xs shrink-0">—</span>
              <input
                type="number"
                min={0}
                value={value.priceMax}
                onChange={e => onChange({ ...value, priceMax: e.target.value })}
                placeholder="Máx."
                className="w-full py-1.5 px-3 text-xs rounded-lg border border-edge bg-card text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </Section>
        )}
      </div>

      {/* Clear all footer */}
      {activeCount > 0 && (
        <div className="pt-4 mt-2 border-t border-edge/60">
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-lg text-xs"
            onClick={() => onChange({ ...EMPTY_FILTER, sortField: value.sortField, sortDir: value.sortDir })}
          >
            Limpiar filtros ({activeCount})
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProductFilter({
  modules,
  layout,
  value,
  onChange,
  categories = [],
  brands = [],
  variantAttributeGroups = [],
  sortOptions = [],
  stockStatusOptions = [],
}: Props) {
  if (layout === 'topbar') {
    return (
      <TopbarLayout
        modules={modules}
        value={value}
        onChange={onChange}
        categories={categories}
        brands={brands}
      />
    )
  }

  return (
    <SidebarLayout
      modules={modules}
      value={value}
      onChange={onChange}
      categories={categories}
      brands={brands}
      variantAttributeGroups={variantAttributeGroups}
      sortOptions={sortOptions}
      stockStatusOptions={stockStatusOptions}
    />
  )
}
