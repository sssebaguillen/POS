'use client'

import { useEffect, useMemo, useState } from 'react'
import ProductGrid from '@/components/catalog/ProductGrid'
import CartPanel from '@/components/catalog/CartPanel'
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

type ViewMode = 'grid' | 'list'

const VIEW_MODE_KEY = 'catalog-view-mode'
const CART_TTL_MS = 8 * 60 * 60 * 1000

interface StoredCart {
  items: CatalogCartItem[]
  savedAt: number
}

function cartItemKey(item: CatalogCartItem): string {
  return `${item.product.id}:${item.variantId ?? ''}`
}

function getStoredCartItems(cartKey: string, products: CatalogProduct[]): CatalogCartItem[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(cartKey)
  if (!raw) return []
  try {
    const stored = JSON.parse(raw) as StoredCart | CatalogCartItem[]
    const items = Array.isArray(stored) ? stored : stored.items
    const savedAt = Array.isArray(stored) ? 0 : stored.savedAt
    if (Date.now() - savedAt > CART_TTL_MS) {
      localStorage.removeItem(cartKey)
      return []
    }
    const productsById = new Map(products.map(p => [p.id, p]))
    return items.flatMap(item => {
      const product = productsById.get(item.product.id)
      if (!product) return []
      const quantity = Math.min(item.quantity, product.stock)
      if (quantity <= 0) return []
      return [{ product, quantity, variantId: item.variantId ?? null, variantLabel: item.variantLabel ?? null, variantImageUrl: item.variantImageUrl ?? null }]
    })
  } catch {
    return []
  }
}

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
  const cartKey = `catalog-cart-${business.id}`

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
    const payload: StoredCart = { items: cartItems, savedAt: Date.now() }
    localStorage.setItem(cartKey, JSON.stringify(payload))
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

  const activeFilterCount = countActiveFilters(filterValue)

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
    <div className="mx-auto w-full max-w-7xl space-y-4 md:space-y-6">
      <CatalogHeader
        business={business}
        cartCount={cartCount}
        onToggleMobileCart={() => setIsMobileCartOpen(prev => !prev)}
      />

      <section
        className={[
          'grid grid-cols-1 gap-4 lg:gap-6',
          isFilterOpen && !isMobileView
            ? 'lg:grid-cols-[240px_minmax(0,1fr)_360px]'
            : 'lg:grid-cols-[minmax(0,1fr)_360px]',
        ].join(' ')}
      >
        {/* Desktop filter sidebar — shown inline when open */}
        {isFilterOpen && !isMobileView && (
          <div className="hidden lg:block">
            <div className="surface-card rounded-xl border border-border/70 p-4 sticky top-4">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filtros
              </p>
              {filterContent}
            </div>
          </div>
        )}

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

        <div className={`${isMobileCartOpen ? 'block' : 'hidden'} lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-hidden`}>
          <CartPanel
            businessName={business.name}
            businessWhatsapp={business.whatsapp}
            cartItems={cartItems}
            onIncreaseQuantity={increaseQuantity}
            onDecreaseQuantity={decreaseQuantity}
            onRemoveItem={removeItem}
            onClearCart={clearCart}
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
