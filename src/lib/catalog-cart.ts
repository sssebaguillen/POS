import type { CatalogCartItem, CatalogProduct } from '@/components/catalog/types'

const CART_TTL_MS = 8 * 60 * 60 * 1000

export interface StoredCart {
  items: CatalogCartItem[]
  savedAt: number
}

export function catalogCartKey(businessId: string): string {
  return `catalog-cart-${businessId}`
}

export function cartItemKey(item: CatalogCartItem): string {
  return `${item.product.id}:${item.variantId ?? ''}`
}

export function saveStoredCart(cartKey: string, items: CatalogCartItem[]) {
  const payload: StoredCart = { items, savedAt: Date.now() }
  localStorage.setItem(cartKey, JSON.stringify(payload))
}

function readStoredCart(cartKey: string): StoredCart | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(cartKey)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredCart | CatalogCartItem[]
    // Formato legacy: array plano sin savedAt
    const stored: StoredCart = Array.isArray(parsed)
      ? { items: parsed, savedAt: 0 }
      : parsed
    if (Date.now() - stored.savedAt > CART_TTL_MS) {
      localStorage.removeItem(cartKey)
      return null
    }
    return stored
  } catch {
    return null
  }
}

// Rehidrata el carrito re-validando cada ítem contra el listado fresco de productos
// (precio/stock vigentes); descarta productos que ya no existen y recorta al stock.
export function getStoredCartItems(cartKey: string, products: CatalogProduct[]): CatalogCartItem[] {
  const stored = readStoredCart(cartKey)
  if (!stored) return []
  const productsById = new Map(products.map(p => [p.id, p]))
  return stored.items.flatMap(item => {
    const product = productsById.get(item.product.id)
    if (!product) return []
    const quantity = Math.min(item.quantity, product.stock)
    if (quantity <= 0) return []
    return [{ product, quantity, variantId: item.variantId ?? null, variantLabel: item.variantLabel ?? null, variantImageUrl: item.variantImageUrl ?? null }]
  })
}

// Lee los items guardados tal cual (sin revalidar contra productos frescos) —
// para rutas que no cargan el listado completo (detalle, /promotions). El
// checkout re-precia server-side, así que el precio guardado es solo display.
export function getStoredCartItemsUnvalidated(cartKey: string): CatalogCartItem[] {
  const stored = readStoredCart(cartKey)
  if (!stored) return []
  return stored.items.map(item => ({
    ...item,
    variantId: item.variantId ?? null,
    variantLabel: item.variantLabel ?? null,
    variantImageUrl: item.variantImageUrl ?? null,
  }))
}

// Upsert directo a localStorage para agregar al carrito desde rutas que no montan
// CatalogView (detalle de producto, /promotions); el carrito se rehidrata al volver.
export function addItemToStoredCart(cartKey: string, newItem: CatalogCartItem): CatalogCartItem[] {
  const stored = readStoredCart(cartKey) ?? { items: [], savedAt: Date.now() }
  const key = cartItemKey(newItem)
  const existing = stored.items.find(item => cartItemKey(item) === key)

  const nextItems = existing
    ? stored.items.map(item =>
        cartItemKey(item) === key ? { ...item, quantity: item.quantity + newItem.quantity } : item
      )
    : [...stored.items, newItem]

  saveStoredCart(cartKey, nextItems)
  return nextItems
}
