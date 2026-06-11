'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SlidersHorizontal, X } from 'lucide-react'
import ProductGrid from '@/components/catalog/ProductGrid'
import OffersCarousel from '@/components/catalog/OffersCarousel'
import { useCatalogShell } from '@/components/catalog/CatalogShell'
import SelectDropdown from '@/components/ui/SelectDropdown'
import ProductFilter, {
  EMPTY_FILTER,
  countActiveFilters,
  type FilterCategory,
  type FilterBrand,
  type ProductFilterValue,
  type VariantAttributeGroup,
} from '@/components/shared/ProductFilter'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type {
  CatalogCategory,
  CatalogProduct,
  CatalogVariantAttributeGroup,
} from '@/components/catalog/types'

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Nombre A-Z' },
  { value: 'name-desc', label: 'Nombre Z-A' },
  { value: 'price-asc', label: 'Precio menor' },
  { value: 'price-desc', label: 'Precio mayor' },
]

interface CatalogViewProps {
  slug: string
  products: CatalogProduct[]
  categories: CatalogCategory[]
  variantAttributeGroups: CatalogVariantAttributeGroup[]
}

interface VariantAttributeGroupSource {
  typeId?: string
  typeName?: string
  type_id?: string
  type_name?: string
  values?: Array<{
    value: string
    productIds?: string[]
    product_ids?: string[]
  }>
}

function applyFilters(
  products: CatalogProduct[],
  f: ProductFilterValue,
  variantGroups: VariantAttributeGroup[]
): CatalogProduct[] {
  const priceMin = f.priceMin !== '' ? Number(f.priceMin) : null
  const priceMax = f.priceMax !== '' ? Number(f.priceMax) : null
  const activeVariantEntries = Object.entries(f.variantAttributes).filter(
    ([, selected]) => selected.length > 0
  )

  const result = products.filter(product => {
    if (f.categoryIds.length > 0) {
      if (!product.categoryId || !f.categoryIds.includes(product.categoryId)) return false
    }
    if (f.brandIds.length > 0) {
      if (!product.brandId || !f.brandIds.includes(product.brandId)) return false
    }
    if (priceMin !== null && product.salePrice < priceMin) return false
    if (priceMax !== null && product.salePrice > priceMax) return false

    if (activeVariantEntries.length > 0) {
      if (!product.hasVariants) return false
      for (const [typeId, selectedValues] of activeVariantEntries) {
        const group = variantGroups.find(g => g.typeId === typeId)
        if (!group) continue
        const matchingIds = new Set(
          group.values
            .filter(v => selectedValues.includes(v.value))
            .flatMap(v => v.productIds)
        )
        if (!matchingIds.has(product.id)) return false
      }
    }

    return true
  })

  return [...result].sort((a, b) => {
    switch (f.sortField) {
      case 'name-desc':  return b.name.localeCompare(a.name, 'es')
      case 'price-asc':  return a.salePrice - b.salePrice
      case 'price-desc': return b.salePrice - a.salePrice
      default:           return a.name.localeCompare(b.name, 'es')
    }
  })
}

export default function CatalogView({
  slug,
  products,
  categories,
  variantAttributeGroups,
}: CatalogViewProps) {
  const { addToCart, business } = useCatalogShell()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Búsqueda aplicada desde el typeahead del navbar ("Ver los N resultados").
  // La URL es la fuente de verdad: compartible y sobrevive al back desde el detalle.
  const searchQuery = (searchParams.get('q') ?? '').trim()

  const [filterValue, setFilterValue] = useState<ProductFilterValue>(EMPTY_FILTER)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)

  // Detect mobile breakpoint after mount (lg = 1024px)
  useEffect(() => {
    const check = () => setIsMobileView(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Sidebar de filtros (desktop): siempre montado en lg; la apertura anima el
  // track de la grilla (grid-template-columns 0px↔240px) junto con el panel.
  const showDesktopFilter = isFilterOpen && !isMobileView

  const activeFilterCount = countActiveFilters(filterValue) + (searchQuery ? 1 : 0)

  // Sección Ofertas: promos vigentes marcadas como destacadas. Colapsa animada
  // cuando hay filtros activos para no duplicar resultados.
  const featuredOffers = useMemo(
    () => products.filter(p => p.promo !== null && p.promo.featured),
    [products]
  )
  const offersOpen = activeFilterCount === 0

  function clearSearchQuery() {
    router.replace(pathname, { scroll: false })
  }

  const filterCategories: FilterCategory[] = categories.map(c => ({ id: c.id, name: c.name }))

  const filterBrands: FilterBrand[] = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of products) {
      if (p.brandId && p.brandName && !seen.has(p.brandId)) {
        seen.set(p.brandId, p.brandName)
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [products])

  const normalizedVariantAttributeGroups = useMemo<VariantAttributeGroup[]>(() => {
    return variantAttributeGroups.flatMap(group => {
      const source = group as CatalogVariantAttributeGroup & VariantAttributeGroupSource
      const typeId = source.typeId ?? source.type_id
      const typeName = source.typeName ?? source.type_name

      if (!typeId || !typeName) {
        return []
      }

      return [{
        typeId,
        typeName,
        values: (source.values ?? []).map(valueGroup => ({
          value: valueGroup.value,
          productIds: valueGroup.productIds ?? [],
        })),
      }]
    })
  }, [variantAttributeGroups])

  const filteredProducts = useMemo(() => {
    let base = products
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      base = base.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.brandName?.toLowerCase().includes(q) ?? false)
      )
    }
    return applyFilters(base, filterValue, normalizedVariantAttributeGroups)
  }, [products, searchQuery, filterValue, normalizedVariantAttributeGroups])

  // Solo los filtros que viven en el panel "Más filtros" (la categoría se ve en los chips)
  const panelFilterCount =
    filterValue.brandIds.length +
    Object.values(filterValue.variantAttributes).flat().length +
    (filterValue.priceMin || filterValue.priceMax ? 1 : 0)

  const hasPriceFilter = filterValue.priceMin !== '' || filterValue.priceMax !== ''
  const priceChipLabel = hasPriceFilter
    ? filterValue.priceMin && filterValue.priceMax
      ? `$${filterValue.priceMin}–$${filterValue.priceMax}`
      : filterValue.priceMin
        ? `Desde $${filterValue.priceMin}`
        : `Hasta $${filterValue.priceMax}`
    : null

  function removeBrand(id: string) {
    setFilterValue(v => ({ ...v, brandIds: v.brandIds.filter(b => b !== id) }))
  }

  function removeVariantValue(typeId: string, val: string) {
    setFilterValue(v => {
      const current = v.variantAttributes[typeId] ?? []
      const next = current.filter(x => x !== val)
      const nextMap = { ...v.variantAttributes }
      if (next.length === 0) delete nextMap[typeId]
      else nextMap[typeId] = next
      return { ...v, variantAttributes: nextMap }
    })
  }

  const sortValue = filterValue.sortField.includes('-') ? filterValue.sortField : 'name-asc'

  const activeChipClass =
    'inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-primary/15 active:scale-[0.97] dark:border-primary/30 dark:bg-primary/15'

  const filterContent = (
    <ProductFilter
      modules={['brand', 'variant-attributes', 'price-range']}
      layout="sidebar"
      value={filterValue}
      onChange={setFilterValue}
      brands={filterBrands}
      variantAttributeGroups={normalizedVariantAttributeGroups}
    />
  )

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Identidad de la tienda — la cara del negocio antes de filtros y grilla.
          El único h1 de la página; el logo ya vive en el navbar */}
      <header className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground md:text-3xl">{business.name}</h1>
        {business.description && (
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">{business.description}</p>
        )}
      </header>

      <section
        className={[
          'grid grid-cols-1 gap-4 lg:gap-y-6',
          'lg:transition-[grid-template-columns,column-gap] lg:duration-[var(--resize-dur)] lg:ease-[var(--resize-ease)] motion-reduce:transition-none',
          showDesktopFilter
            ? 'lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-x-6'
            : 'lg:grid-cols-[0px_minmax(0,1fr)] lg:gap-x-0',
        ].join(' ')}
      >
        {/* Desktop filter sidebar — siempre montado en lg; el track de la grilla
            anima su ancho y este wrapper clipea el panel durante el tween */}
        <div className="hidden min-w-0 overflow-x-clip lg:block">
          <div
            inert={!showDesktopFilter}
            aria-hidden={!showDesktopFilter}
            className={`surface-card sticky top-16 w-60 rounded-xl border border-border/70 p-4 transition-[transform,opacity] duration-[var(--resize-dur)] ease-[var(--resize-ease)] motion-reduce:transition-none ${
              showDesktopFilter ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
            }`}
          >
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Filtros
            </p>
            {filterContent}
          </div>
        </div>

        <div className="min-w-0">
          {/* Hero de ofertas — colapsa animado al activar filtros (sin salto de layout) */}
          {featuredOffers.length > 0 && (
            <div
              className="t-collapse"
              data-open={offersOpen}
              inert={!offersOpen}
              aria-hidden={!offersOpen}
            >
              {/* py compensado con -my: corre el clip vertical 40px más allá de la
                  card para que el glow respire; el layout neto no cambia */}
              <div className="-my-10 py-10">
                <div className="pb-4 lg:pb-6">
                  <OffersCarousel offers={featuredOffers} slug={slug} onAddToCart={addToCart} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 lg:space-y-6">
          {/* Fila única: chips de categoría (scrolleables) + orden + panel de filtros */}
          {products.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {filterCategories.length > 0 && (
                <div className="min-w-0 flex-1 basis-64">
                  <ProductFilter
                    modules={['category']}
                    layout="topbar"
                    value={filterValue}
                    onChange={setFilterValue}
                    categories={filterCategories}
                  />
                </div>
              )}

              <div className="ml-auto flex shrink-0 items-center gap-2">
                <SelectDropdown
                  value={sortValue}
                  onChange={field => setFilterValue(v => ({ ...v, sortField: field }))}
                  options={SORT_OPTIONS}
                  className="w-36"
                  usePortal
                />
                <button
                  type="button"
                  onClick={() => setIsFilterOpen(prev => !prev)}
                  className={[
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]',
                    isFilterOpen
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-background text-foreground hover:border-primary/40',
                  ].join(' ')}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Más filtros
                  {panelFilterCount > 0 && (
                    <span className={[
                      'ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                      isFilterOpen
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-primary text-primary-foreground',
                    ].join(' ')}>
                      {panelFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Línea de feedback — solo cuando hay filtros activos: conteo + chips removibles */}
          {products.length > 0 && activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {filteredProducts.length === 1
                  ? '1 producto'
                  : `${filteredProducts.length} productos`}
              </p>

              {/* Chip de búsqueda aplicada desde el navbar */}
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearchQuery}
                  className={activeChipClass}
                  aria-label={`Quitar búsqueda ${searchQuery}`}
                >
                  “{searchQuery}”
                  <X className="h-3 w-3" />
                </button>
              )}

              {/* Chips removibles de filtros activos del panel */}
              {filterValue.brandIds.map(id => {
                const brand = filterBrands.find(b => b.id === id)
                if (!brand) return null
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => removeBrand(id)}
                    className={activeChipClass}
                    aria-label={`Quitar filtro ${brand.name}`}
                  >
                    {brand.name}
                    <X className="h-3 w-3" />
                  </button>
                )
              })}
              {Object.entries(filterValue.variantAttributes).flatMap(([typeId, values]) =>
                values.map(val => (
                  <button
                    key={`${typeId}-${val}`}
                    type="button"
                    onClick={() => removeVariantValue(typeId, val)}
                    className={activeChipClass}
                    aria-label={`Quitar filtro ${val}`}
                  >
                    {val}
                    <X className="h-3 w-3" />
                  </button>
                ))
              )}
              {priceChipLabel && (
                <button
                  type="button"
                  onClick={() => setFilterValue(v => ({ ...v, priceMin: '', priceMax: '' }))}
                  className={activeChipClass}
                  aria-label="Quitar filtro de precio"
                >
                  {priceChipLabel}
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {/* El carrito vive en el sheet global del shell (botón del navbar / barra mobile) */}
          <ProductGrid
            slug={slug}
            products={filteredProducts}
            totalCount={products.length}
            onClearFilters={() => {
              setFilterValue(EMPTY_FILTER)
              if (searchQuery) clearSearchQuery()
            }}
            onAddToCart={addToCart}
          />
          </div>
        </div>
      </section>

      {/* Mobile filter — bottom sheet */}
      <Sheet open={isFilterOpen && isMobileView} onOpenChange={open => setIsFilterOpen(open)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Filtros
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            {filterContent}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
