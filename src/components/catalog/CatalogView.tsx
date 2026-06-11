'use client'

import { useEffect, useMemo, useState } from 'react'
import ProductGrid from '@/components/catalog/ProductGrid'
import OffersCarousel from '@/components/catalog/OffersCarousel'
import { useCatalogShell } from '@/components/catalog/CatalogShell'
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

type ViewMode = 'grid' | 'list'

const VIEW_MODE_KEY = 'catalog-view-mode'

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

export default function CatalogView({
  slug,
  products,
  categories,
  variantAttributeGroups,
}: CatalogViewProps) {
  const { addToCart } = useCatalogShell()

  const [filterValue, setFilterValue] = useState<ProductFilterValue>(EMPTY_FILTER)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Detect mobile breakpoint after mount (lg = 1024px)
  useEffect(() => {
    const check = () => setIsMobileView(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'list' || stored === 'grid') setViewMode(stored)
  }, [])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  // Entrada/salida animada del sidebar de filtros (desktop): mantener montado
  // durante la transición para poder animar el cierre antes de desmontar.
  const showDesktopFilter = isFilterOpen && !isMobileView
  const [filterMounted, setFilterMounted] = useState(showDesktopFilter)
  const [filterVisible, setFilterVisible] = useState(showDesktopFilter)

  useEffect(() => {
    if (showDesktopFilter) {
      setFilterMounted(true)
      // Doble rAF: asegura un paint del estado oculto antes de activar la
      // transición; con un solo frame React re-renderiza antes del paint y
      // el browser nunca ve el estado inicial (la animación no corre).
      let innerFrameId: number | null = null
      const frameId = requestAnimationFrame(() => {
        innerFrameId = requestAnimationFrame(() => setFilterVisible(true))
      })
      return () => {
        cancelAnimationFrame(frameId)
        if (innerFrameId !== null) cancelAnimationFrame(innerFrameId)
      }
    }
    setFilterVisible(false)
    const timeoutId = setTimeout(() => setFilterMounted(false), 200)
    return () => clearTimeout(timeoutId)
  }, [showDesktopFilter])

  const activeFilterCount = countActiveFilters(filterValue)

  // Sección Ofertas: promos vigentes marcadas como destacadas. Se oculta cuando
  // hay filtros activos para no duplicar resultados.
  const featuredOffers = useMemo(
    () => products.filter(p => p.promo !== null && p.promo.featured),
    [products]
  )
  const showOffersSection = featuredOffers.length > 0 && activeFilterCount === 0

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
    const hasVariantFilter = Object.values(filterValue.variantAttributes).some(
      selectedValues => selectedValues.length > 0
    )

    if (!hasVariantFilter) {
      return products
    }

    return products.filter(product => {
      if (!product.hasVariants) {
        return false
      }

      for (const [typeId, selectedValues] of Object.entries(filterValue.variantAttributes)) {
        if (!selectedValues || selectedValues.length === 0) {
          continue
        }

        const group = normalizedVariantAttributeGroups.find(
          variantGroup => variantGroup.typeId === typeId
        )

        if (!group) {
          continue
        }

        const matchingProductIds = new Set(
          group.values
            .filter(valueGroup => selectedValues.includes(valueGroup.value))
            .flatMap(valueGroup => valueGroup.productIds)
        )

        if (!matchingProductIds.has(product.id)) {
          return false
        }
      }

      return true
    })
  }, [filterValue.variantAttributes, normalizedVariantAttributeGroups, products])

  const filterContent = (
    <ProductFilter
      modules={['category', 'brand', 'variant-attributes', 'price-range', 'sort']}
      layout="sidebar"
      value={filterValue}
      onChange={setFilterValue}
      categories={filterCategories}
      brands={filterBrands}
      variantAttributeGroups={normalizedVariantAttributeGroups}
      sortOptions={[
        { field: 'name-asc', label: 'Nombre A-Z' },
        { field: 'name-desc', label: 'Nombre Z-A' },
        { field: 'price-asc', label: 'Precio menor' },
        { field: 'price-desc', label: 'Precio mayor' },
      ]}
    />
  )

  return (
    <div className="space-y-4 md:space-y-6">
      <section
        className={[
          'grid grid-cols-1 gap-4 lg:gap-6',
          filterMounted && !isMobileView ? 'lg:grid-cols-[240px_minmax(0,1fr)]' : '',
        ].join(' ')}
      >
        {/* Desktop filter sidebar — shown inline when open */}
        {filterMounted && !isMobileView && (
          <div className="hidden lg:block">
            <div
              className={`surface-card rounded-xl border border-border/70 p-4 sticky top-16 transition-[transform,opacity] duration-200 ease-[var(--ease-out)] ${
                filterVisible ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'
              }`}
            >
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filtros
              </p>
              {filterContent}
            </div>
          </div>
        )}

        <div className="min-w-0 space-y-4 lg:space-y-6">
          {/* Hero de ofertas */}
          {showOffersSection && (
            <OffersCarousel offers={featuredOffers} slug={slug} onAddToCart={addToCart} />
          )}

          {/* El carrito vive en el sheet global del shell (botón del navbar / barra mobile) */}
          <ProductGrid
            slug={slug}
            products={filteredProducts}
            filterValue={filterValue}
            onClearFilters={() => setFilterValue(EMPTY_FILTER)}
            onAddToCart={addToCart}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onToggleFilter={() => setIsFilterOpen(prev => !prev)}
            isFilterOpen={isFilterOpen}
            activeFilterCount={activeFilterCount}
          />
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
