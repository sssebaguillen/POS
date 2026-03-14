'use client'

import { useMemo, useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ProductGrid from '@/components/catalogo/ProductGrid'
import CartPanel from '@/components/catalogo/CartPanel'
import type { CatalogBusiness, CatalogCartItem, CatalogCategory, CatalogProduct } from '@/components/catalogo/types'

interface CatalogViewProps {
  business: CatalogBusiness
  products: CatalogProduct[]
  categories: CatalogCategory[]
}

export default function CatalogView({ business, products, categories }: CatalogViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CatalogCartItem[]>([])

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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 md:space-y-6">
      <section className="rounded-xl border border-border/70 bg-card p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{business.name}</h1>
            {business.description && (
              <p className="mt-2 text-sm text-muted-foreground">{business.description}</p>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            className="lg:hidden"
            onClick={() => setIsMobileCartOpen(prev => !prev)}
          >
            <ShoppingCart className="mr-1 h-4 w-4" />
            Carrito ({cartCount})
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <ProductGrid
          products={products}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          onAddToCart={addToCart}
        />

        <div className={`${isMobileCartOpen ? 'block' : 'hidden'} lg:block`}>
          <CartPanel
            businessName={business.name}
            businessWhatsapp={business.whatsapp}
            cartItems={cartItems}
            onIncreaseQuantity={increaseQuantity}
            onDecreaseQuantity={decreaseQuantity}
            onRemoveItem={removeItem}
          />
        </div>
      </section>
    </div>
  )
}