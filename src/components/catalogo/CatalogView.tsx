'use client'

import { useEffect, useMemo, useState } from 'react'
import ProductGrid from '@/components/catalogo/ProductGrid'
import CartPanel from '@/components/catalogo/CartPanel'
import CatalogHeader from '@/components/catalogo/CatalogHeader'
import type { CatalogBusiness, CatalogCartItem, CatalogCategory, CatalogProduct } from '@/components/catalogo/types'

type ViewMode = 'grid' | 'list'
type SortBy = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc'

const VIEW_MODE_KEY = 'catalog-view-mode'

function getStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') {
    return 'grid'
  }

  const stored = localStorage.getItem(VIEW_MODE_KEY)
  return stored === 'list' ? 'list' : 'grid'
}

function getStoredCartItems(
  cartKey: string,
  products: CatalogProduct[]
): CatalogCartItem[] {
  if (typeof window === 'undefined') {
    return []
  }

  const storedCart = localStorage.getItem(cartKey)
  if (!storedCart) {
    return []
  }

  try {
    const parsed = JSON.parse(storedCart) as CatalogCartItem[]
    const productIds = new Set(products.map(product => product.id))
    return parsed.filter(item => productIds.has(item.product.id))
  } catch {
    return []
  }
}

interface CatalogViewProps {
  business: CatalogBusiness
  products: CatalogProduct[]
  categories: CatalogCategory[]
}

export default function CatalogView({ business, products, categories }: CatalogViewProps) {
  const cartKey = `catalog-cart-${business.id}`
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CatalogCartItem[]>(() => getStoredCartItems(cartKey, products))
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name-asc')

  useEffect(() => {
    localStorage.setItem(cartKey, JSON.stringify(cartItems))
  }, [cartItems, cartKey])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  const cartCount = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems]
  )

  function addToCart(product: CatalogProduct) {
    if (product.stock <= 0) return

    setCartItems(prev => {
      const existing = prev.find(item => item.product.id === product.id)
      if (!existing) {
        return [...prev, { product, quantity: 1 }]
      }

      if (existing.quantity >= product.stock) {
        return prev
      }

      return prev.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    })
  }

  function increaseQuantity(productId: string) {
    setCartItems(prev =>
      prev.map(item => {
        if (item.product.id !== productId) return item
        if (item.quantity >= item.product.stock) return item
        return { ...item, quantity: item.quantity + 1 }
      })
    )
  }

  function decreaseQuantity(productId: string) {
    setCartItems(prev =>
      prev
        .map(item => {
          if (item.product.id !== productId) return item
          return { ...item, quantity: item.quantity - 1 }
        })
        .filter(item => item.quantity > 0)
    )
  }

  function removeItem(productId: string) {
    setCartItems(prev => prev.filter(item => item.product.id !== productId))
  }

  function clearCart() {
    setCartItems([])
    localStorage.removeItem(cartKey)
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 md:space-y-6">
      <CatalogHeader
        business={business}
        cartCount={cartCount}
        onToggleMobileCart={() => setIsMobileCartOpen(prev => !prev)}
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <ProductGrid
          products={products}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          onAddToCart={addToCart}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />

        <div className={`${isMobileCartOpen ? 'block' : 'hidden'} lg:block`}>
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
