'use client'

import { useEffect, useMemo, useState } from 'react'
import ProductGrid from '@/components/catalog/ProductGrid'
import CartPanel from '@/components/catalog/CartPanel'
import CatalogHeader from '@/components/catalog/CatalogHeader'
import ProductFilter, {
  EMPTY_FILTER,
  type FilterCategory,
  type FilterBrand,
  type ProductFilterValue,
} from '@/components/shared/ProductFilter'
import type {
  CatalogBusiness,
  CatalogCartItem,
  CatalogCategory,
  CatalogProduct,
  CatalogVariantAttributeGroup,
} from '@/components/catalog/types'

type ViewMode = 'grid' | 'list'

const VIEW_MODE_KEY = 'catalog-view-mode'
const CART_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

interface StoredCart {
  items: CatalogCartItem[]
  savedAt: number
}

function cartItemKey(item: CatalogCartItem): string {
  return `${item.product.id}:${item.variantId ?? ''}`
}

function getStoredCartItems(
  cartKey: string,
  products: CatalogProduct[]
): CatalogCartItem[] {
  if (typeof window === 'undefined') {
    return []
  }

  const raw = localStorage.getItem(cartKey)
  if (!raw) {
    return []
  }

  try {
    const stored = JSON.parse(raw) as StoredCart | CatalogCartItem[]
    const items = Array.isArray(stored) ? stored : stored.items
    const savedAt = Array.isArray(stored) ? 0 : stored.savedAt

    if (Date.now() - savedAt > CART_TTL_MS) {
      localStorage.removeItem(cartKey)
      return []
    }

    const productsById = new Map(products.map(product => [product.id, product]))

    return items.flatMap(item => {
      const product = productsById.get(item.product.id)
      if (!product) return []

      const quantity = Math.min(item.quantity, product.stock)
      if (quantity <= 0) return []

      return [{
        product,
        quantity,
        variantId: (item as CatalogCartItem).variantId ?? null,
        variantLabel: (item as CatalogCartItem).variantLabel ?? null,
      }]
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

export default function CatalogView({
  business,
  slug,
  products,
  categories,
  variantAttributeGroups,
}: CatalogViewProps) {
  const cartKey = `catalog-cart-${business.id}`

  const [filterValue, setFilterValue] = useState<ProductFilterValue>(EMPTY_FILTER)
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CatalogCartItem[]>(() =>
    getStoredCartItems(cartKey, products)
  )
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [hasLoadedViewMode, setHasLoadedViewMode] = useState(false)

  useEffect(() => {
    const payload: StoredCart = { items: cartItems, savedAt: Date.now() }
    localStorage.setItem(cartKey, JSON.stringify(payload))
  }, [cartItems, cartKey])

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'list' || stored === 'grid') {
      setViewMode(stored)
    }
    setHasLoadedViewMode(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedViewMode) return
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode, hasLoadedViewMode])

  const cartCount = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems]
  )

  function addToCart(product: CatalogProduct, variantId: string | null = null, variantLabel: string | null = null) {
    if (product.stock <= 0) return

    const key = `${product.id}:${variantId ?? ''}`

    setCartItems(prev => {
      const existing = prev.find(item => cartItemKey(item) === key)
      if (!existing) {
        return [...prev, { product, quantity: 1, variantId, variantLabel }]
      }
      if (existing.quantity >= product.stock) return prev
      return prev.map(item =>
        cartItemKey(item) === key
          ? { ...item, quantity: item.quantity + 1 }
          : item
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
        .map(item => {
          if (cartItemKey(item) !== key) return item
          return { ...item, quantity: item.quantity - 1 }
        })
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

  // Build filter options from catalog data
  const filterCategories: FilterCategory[] = categories.map(c => ({ id: c.id, name: c.name }))

  const filterBrands: FilterBrand[] = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of products) {
      if (p.brandId && !seen.has(p.brandId)) {
        seen.set(p.brandId, p.brandId)
      }
    }
    return Array.from(seen.entries()).map(([id]) => ({ id, name: id }))
  }, [products])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 md:space-y-6">
      <CatalogHeader
        business={business}
        cartCount={cartCount}
        onToggleMobileCart={() => setIsMobileCartOpen(prev => !prev)}
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px] lg:gap-6">
        {/* Sidebar filter */}
        <div className="hidden lg:block">
          <div className="surface-card p-4 rounded-xl border border-border/70 sticky top-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Filtros</p>
            <ProductFilter
              modules={['search', 'category', 'brand', 'variant-attributes', 'price-range', 'sort']}
              layout="sidebar"
              value={filterValue}
              onChange={setFilterValue}
              categories={filterCategories}
              brands={filterBrands}
              variantAttributeGroups={variantAttributeGroups}
              sortOptions={[
                { field: 'name-asc', label: 'Nombre A-Z' },
                { field: 'name-desc', label: 'Nombre Z-A' },
                { field: 'price-asc', label: 'Precio menor' },
                { field: 'price-desc', label: 'Precio mayor' },
              ]}
            />
          </div>
        </div>

        <ProductGrid
          slug={slug}
          products={products}
          categories={categories}
          filterValue={filterValue}
          onFilterChange={setFilterValue}
          onAddToCart={addToCart}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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
    </div>
  )
}
