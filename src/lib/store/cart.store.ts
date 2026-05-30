import { create } from 'zustand'
import type { CartItem, Product, ProductVariant } from '@/lib/types'
import { getCartItemId } from '@/lib/types'

export type DiscountMode = 'fixed' | 'percent'

export interface CartDiscount {
  mode: DiscountMode
  value: number
}

// Resolves the absolute discount amount against a given subtotal.
// Percent is computed on the subtotal; both modes are clamped to [0, subtotal].
export function resolveDiscountAmount(subtotal: number, mode: DiscountMode, value: number): number {
  if (!value || value <= 0 || subtotal <= 0) return 0
  const raw = mode === 'percent' ? (subtotal * value) / 100 : value
  const clamped = Math.min(Math.max(0, raw), subtotal)
  return Math.round(clamped * 100) / 100
}

interface CartStore {
  items: CartItem[]
  discountMode: DiscountMode
  discountValue: number
  customerId: string | null

  addItem: (product: Product) => void
  addVariantItem: (product: Product, variant: ProductVariant, variantLabel: string) => void
  addFreeLineItem: (id: string, description: string, price: number, quantity: number) => void
  removeItem: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  updatePrice: (itemId: string, price: number) => void
  setDiscount: (mode: DiscountMode, value: number) => void
  clearDiscount: () => void
  setCustomer: (customerId: string | null) => void
  clearCart: () => void
  restoreCart: (savedItems: CartItem[], savedDiscount: CartDiscount) => void

  subtotal: () => number
  discountAmount: () => number
  total: () => number
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  discountMode: 'fixed',
  discountValue: 0,
  customerId: null,

  addItem: (product) => {
    const items = get().items
    const existing = items.find(
      i => i.product?.id === product.id && i.variant_id === null && i.free_line_id === null
    )
    if (existing) {
      set({
        items: items.map(i =>
          i.product?.id === product.id && i.variant_id === null
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.unit_price }
            : i
        ),
      })
    } else {
      set({
        items: [...items, {
          product,
          free_line_id: null,
          free_line_description: null,
          variant_id: null,
          variant_label: null,
          quantity: 1,
          unit_price: product.price,
          total: product.price,
        }],
      })
    }
  },

  addVariantItem: (product, variant, variantLabel) => {
    const items = get().items
    const existing = items.find(
      i => i.product?.id === product.id && i.variant_id === variant.id
    )
    if (existing) {
      const itemId = getCartItemId(existing)
      set({
        items: items.map(i =>
          getCartItemId(i) === itemId
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.unit_price }
            : i
        ),
      })
    } else {
      set({
        items: [...items, {
          product,
          free_line_id: null,
          free_line_description: null,
          variant_id: variant.id,
          variant_label: variantLabel,
          variant_stock: variant.stock,
          variant_cost: variant.cost,
          variant_base_price: variant.price,
          quantity: 1,
          unit_price: variant.price,
          total: variant.price,
        }],
      })
    }
  },

  addFreeLineItem: (id, description, price, quantity) => {
    set({
      items: [...get().items, {
        product: null,
        free_line_id: id,
        free_line_description: description,
        variant_id: null,
        variant_label: null,
        quantity,
        unit_price: price,
        total: quantity * price,
        priceIsManual: true,
      }],
    })
  },

  removeItem: (itemId) => {
    set({ items: get().items.filter(i => getCartItemId(i) !== itemId) })
  },

  updateQuantity: (itemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(itemId)
      return
    }
    set({
      items: get().items.map(i =>
        getCartItemId(i) === itemId
          ? { ...i, quantity, total: quantity * i.unit_price }
          : i
      ),
    })
  },

  updatePrice: (itemId, price) => {
    set({
      items: get().items.map(i =>
        getCartItemId(i) === itemId
          ? { ...i, unit_price: price, total: i.quantity * price, priceIsManual: true }
          : i
      ),
    })
  },

  setDiscount: (mode, value) => set({ discountMode: mode, discountValue: value }),

  clearDiscount: () => set({ discountMode: 'fixed', discountValue: 0 }),

  setCustomer: (customerId) => set({ customerId }),

  clearCart: () => set({ items: [], discountMode: 'fixed', discountValue: 0, customerId: null }),

  restoreCart: (savedItems, savedDiscount) =>
    set({ items: savedItems, discountMode: savedDiscount.mode, discountValue: savedDiscount.value, customerId: null }),

  subtotal: () => get().items.reduce((sum, i) => sum + i.total, 0),

  discountAmount: () => resolveDiscountAmount(get().subtotal(), get().discountMode, get().discountValue),

  total: () => Math.max(0, get().subtotal() - get().discountAmount()),
}))
