'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ShoppingCart } from '@phosphor-icons/react/dist/ssr'
import CatalogNavbar from '@/components/catalog/CatalogNavbar'
import CatalogFooter from '@/components/catalog/CatalogFooter'
import CartPanel, { lineTotal, type CatalogLastOrder } from '@/components/catalog/CartPanel'
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
} from '@/components/catalog/types'
import {
  cartItemKey,
  catalogCartKey,
  getStoredCartItems,
  getStoredCartItemsUnvalidated,
  saveStoredCart,
} from '@/lib/catalog-cart'

const currencyFormatter = new Intl.NumberFormat('es-AR')

interface CatalogShellContextValue {
  business: CatalogBusiness
  slug: string
  cartItems: CatalogCartItem[]
  cartCount: number
  cartTotal: number
  addToCart: (
    product: CatalogProduct,
    variantId?: string | null,
    variantLabel?: string | null,
    variantImageUrl?: string | null
  ) => void
  increaseQuantity: (key: string) => void
  decreaseQuantity: (key: string) => void
  removeItem: (key: string) => void
  clearCart: () => void
  openCart: () => void
}

const CatalogShellContext = createContext<CatalogShellContextValue | undefined>(undefined)

export function useCatalogShell() {
  const context = useContext(CatalogShellContext)
  if (!context) throw new Error('useCatalogShell must be used within CatalogShell')
  return context
}

interface CatalogShellProps {
  business: CatalogBusiness
  slug: string
  /** Listado fresco: revalida el carrito guardado y alimenta el search del navbar
      (solo la main page lo tiene; en el resto CatalogSearch lo trae lazy) */
  products?: CatalogProduct[]
  categories?: CatalogCategory[]
  children: React.ReactNode
}

export default function CatalogShell({
  business,
  slug,
  products,
  categories,
  children,
}: CatalogShellProps) {
  const cartKey = catalogCartKey(business.id)

  const [cartItems, setCartItems] = useState<CatalogCartItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isMobileView, setIsMobileView] = useState(false)
  // Éxito del último pedido a nivel shell: sobrevive al cierre del sheet (Radix
  // desmonta CartPanel) y el carrito ya quedó vacío — sin riesgo de doble envío
  const [lastOrder, setLastOrder] = useState<CatalogLastOrder | null>(null)

  // Mounted pattern (regla 25): primer render SSR-safe con carrito vacío,
  // hidratación desde localStorage post-mount.
  useEffect(() => {
    setCartItems(
      products
        ? getStoredCartItems(cartKey, products)
        : getStoredCartItemsUnvalidated(cartKey)
    )
    setHydrated(true)
    // products viene del server y es estable durante la vida del componente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey])

  useEffect(() => {
    if (!hydrated) return
    saveStoredCart(cartKey, cartItems)
  }, [cartItems, cartKey, hydrated])

  // lg = 1024px, mismo breakpoint que la columna sticky del carrito
  useEffect(() => {
    const check = () => setIsMobileView(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const cartCount = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems]
  )

  const cartTotal = useMemo(
    () => cartItems.reduce((acc, item) => acc + lineTotal(item), 0),
    [cartItems]
  )

  function addToCart(
    product: CatalogProduct,
    variantId: string | null = null,
    variantLabel: string | null = null,
    variantImageUrl: string | null = null
  ) {
    if (!product.hasVariants && product.stock <= 0) return
    // Agregar algo nuevo arranca un pedido nuevo: el sheet vuelve a mostrar el carrito
    setLastOrder(null)
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

  function handleOrderSuccess(order: CatalogLastOrder) {
    setLastOrder(order)
    clearCart()
  }

  const contextValue: CatalogShellContextValue = {
    business,
    slug,
    cartItems,
    cartCount,
    cartTotal,
    addToCart,
    increaseQuantity,
    decreaseQuantity,
    removeItem,
    clearCart,
    openCart: () => setIsCartOpen(true),
  }

  return (
    <CatalogShellContext.Provider value={contextValue}>
      {/* body global tiene overflow:hidden — el shell es el contenedor de scroll
          (y el ancestro del navbar sticky) */}
      <div className="h-screen overflow-y-auto bg-background">
        <div className="flex min-h-full flex-col">
          <CatalogNavbar
            business={business}
            slug={slug}
            cartCount={cartCount}
            onOpenCart={() => setIsCartOpen(true)}
            products={products}
            categories={categories}
          />

          <main
            className={`mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8 ${
              cartCount > 0 ? 'pb-20 lg:pb-8' : ''
            }`}
          >
            {children}
          </main>

          <CatalogFooter business={business} slug={slug} />
        </div>
      </div>

      {/* Carrito global — bottom sheet en mobile, drawer derecho en desktop */}
      <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
        <SheetContent
          side={isMobileView ? 'bottom' : 'right'}
          className={`t-panel-cart ${
            isMobileView
              ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl'
              : 'w-full overflow-y-auto sm:max-w-md'
          }`}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Tu pedido · {business.name}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <CartPanel
              businessSlug={slug}
              businessName={business.name}
              businessWhatsapp={business.whatsapp}
              cartItems={cartItems}
              onIncreaseQuantity={increaseQuantity}
              onDecreaseQuantity={decreaseQuantity}
              onRemoveItem={removeItem}
              lastOrder={lastOrder}
              onOrderSuccess={handleOrderSuccess}
              onNewOrder={() => setLastOrder(null)}
              embedded
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Barra de pedido mobile: feedback inmediato al agregar + CTA siempre visible */}
      {isMobileView && cartCount > 0 && !isCartOpen && (
        <button
          type="button"
          onClick={() => setIsCartOpen(true)}
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
    </CatalogShellContext.Provider>
  )
}
