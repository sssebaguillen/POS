'use client'

import { useEffect, useMemo, useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import ProductGrid from '@/components/catalog/ProductGrid'
import OffersCarousel from '@/components/catalog/OffersCarousel'
import CartPanel, { lineTotal } from '@/components/catalog/CartPanel'
import CatalogHeader from '@/components/catalog/CatalogHeader'
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
  CatalogBusiness,
  CatalogCartItem,
  CatalogCategory,
  CatalogProduct,
  CatalogVariantAttributeGroup,
} from '@/components/catalog/types'
import {
  cartItemKey,
  catalogCartKey,
  getStoredCartItems,
  saveStoredCart,
} from '@/lib/catalog-cart'

type ViewMode = 'grid' | 'list'

const VIEW_MODE_KEY = 'catalog-view-mode'

const currencyFormatter = new Intl.NumberFormat('es-AR')

interface CatalogViewProps {
  business: CatalogBusiness
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
  business,
  slug,
  products,
  categories,
  variantAttributeGroups,
}: CatalogViewProps) {
  const cartKey = catalogCartKey(business.id)

  const [filterValue, setFilterValue] = useState<ProductFilterValue>(EMPTY_FILTER)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CatalogCartItem[]>(() =>
    getStoredCartItems(cartKey, products)
  )
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Detect mobile breakpoint after mount (lg = 1024px)
  useEffect(() => {
    const check = () => setIsMobileView(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    saveStoredCart(cartKey, cartItems)
  }, [cartItems, cartKey])

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'list' || stored === 'grid') setViewMode(stored)
  }, [])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  const cartCount = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems]
  )

  const cartTotal = useMemo(
    () => cartItems.reduce((acc, item) => acc + lineTotal(item), 0),
    [cartItems]
  )

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
  // hay búsqueda/filtros activos para no duplicar resultados.
  const featuredOffers = useMemo(
    () => products.filter(p => p.promo !== null && p.promo.featured),
    [products]
  )
  const showOffersSection =
    featuredOffers.length > 0 && activeFilterCount === 0 && filterValue.search.trim() === ''

  function addToCart(product: CatalogProduct, variantId: string | null = null, variantLabel: string | null = null, variantImageUrl: string | null = null) {
    if (!product.hasVariants && product.stock <= 0) return
    const key = `${product.id}:${variantId ?? ''}`
    setCartItems(prev => {
      const existing = prev.find(item => cartItemKey(item) === key)
      if (!existing) {
        return [...prev, { product, quantity: 1, variantId, variantLabel, variantImageUrl }]
      }
      if (existing.quantity >= product.stock) return prev
      return prev.map(item =>
        cartItemKey(item) === key ? { ...item, quantity: item.quantity + 1 } : item
      )
    })
  }

  function increaseQuantity(key: string) {
    setCartItems(prev =>
      prev.map(item => {
        if (cartItemKey(item) !== key) return item
        if (item.quantity >= item.product.stock) return item
        return { ...item, quantity: item.quantity + 1 }
      })
    )
  }

  function decreaseQuantity(key: string) {
    setCartItems(prev =>
      prev
        .map(item => (cartItemKey(item) !== key ? item : { ...item, quantity: item.quantity - 1 }))
        .filter(item => item.quantity > 0)
    )
  }

  function removeItem(key: string) {
    setCartItems(prev => prev.filter(item => cartItemKey(item) !== key))
  }

  function clearCart() {
    setCartItems([])
    localStorage.removeItem(cartKey)
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

  const cartPanelProps = {
    businessSlug: slug,
    businessName: business.name,
    businessWhatsapp: business.whatsapp,
    cartItems,
    onIncreaseQuantity: increaseQuantity,
    onDecreaseQuantity: decreaseQuantity,
    onRemoveItem: removeItem,
    onClearCart: clearCart,
  }

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
    <div className={`mx-auto w-full max-w-7xl space-y-4 md:space-y-6 ${cartCount > 0 ? 'pb-20 lg:pb-0' : ''}`}>
      <CatalogHeader
        business={business}
        cartCount={cartCount}
        onToggleMobileCart={() => setIsMobileCartOpen(prev => !prev)}
      />

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
              className={`surface-card rounded-xl border border-border/70 p-4 sticky top-4 transition-[transform,opacity] duration-200 ease-[var(--ease-out)] ${
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
          {/* Hero de ofertas: ocupa el ancho de contenido + carrito; el cart arranca debajo */}
          {showOffersSection && (
            <OffersCarousel offers={featuredOffers} slug={slug} onAddToCart={addToCart} />
          )}

          <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <ProductGrid
                slug={slug}
                products={filteredProducts}
                filterValue={filterValue}
                onFilterChange={setFilterValue}
                onAddToCart={addToCart}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onToggleFilter={() => setIsFilterOpen(prev => !prev)}
                isFilterOpen={isFilterOpen}
                activeFilterCount={activeFilterCount}
              />
            </div>

            {/* Carrito desktop: columna sticky. En mobile vive en el bottom sheet */}
            {!isMobileView && (
              <div className="hidden lg:sticky lg:top-4 lg:block lg:self-start lg:h-[calc(100vh-2rem)] lg:overflow-hidden">
                <CartPanel {...cartPanelProps} />
              </div>
            )}
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

      {/* Mobile cart — bottom sheet */}
      <Sheet open={isMobileCartOpen && isMobileView} onOpenChange={open => setIsMobileCartOpen(open)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Tu pedido · {business.name}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <CartPanel {...cartPanelProps} embedded />
          </div>
        </SheetContent>
      </Sheet>

      {/* Barra de pedido mobile: feedback inmediato al agregar + CTA siempre visible */}
      {isMobileView && cartCount > 0 && !isMobileCartOpen && (
        <button
          type="button"
          onClick={() => setIsMobileCartOpen(true)}
          className="fixed inset-x-4 z-40 flex h-12 items-center justify-between rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg outline-none transition-transform duration-150 ease-[var(--ease-out)] focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] lg:hidden"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Ver pedido ({cartCount})
          </span>
          <span>${currencyFormatter.format(cartTotal)}</span>
        </button>
      )}
    </div>
  )
}
