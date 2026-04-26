import { create } from 'zustand'
import type { CartItem, Product } from '@/lib/types'

interface CartStore {
  items: CartItem[]
  discount: number
  customerId: string | null

  addItem: (product: Product) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  updatePrice: (productId: string, price: number) => void
  setDiscount: (discount: number) => void
  setCustomer: (customerId: string | null) => void
  clearCart: () => void
  restoreCart: (savedItems: CartItem[], savedDiscount: number) => void

  subtotal: () => number
  total: () => number
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  discount: 0,
  customerId: null,

  addItem: (product) => {
    const items = get().items
    const existing = items.find(i => i.product.id === product.id)
    if (existing) {
      set({
        items: items.map(i =>
          i.product.id === product.id
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.unit_price }
            : i
        ),
      })
    } else {
      set({
        items: [...items, {
          product,
          quantity: 1,
          unit_price: product.price,
          total: product.price,
        }],
      })
    }
  },

  removeItem: (productId) => {
    set({ items: get().items.filter(i => i.product.id !== productId) })
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId)
      return
    }
    set({
      items: get().items.map(i =>
        i.product.id === productId
          ? { ...i, quantity, total: quantity * i.unit_price }
          : i
      ),
    })
  },

  updatePrice: (productId, price) => {
    set({
      items: get().items.map(i =>
        i.product.id === productId
          ? { ...i, unit_price: price, total: i.quantity * price, priceIsManual: true }
          : i
      ),
    })
  },

  setDiscount: (discount) => set({ discount }),

  setCustomer: (customerId) => set({ customerId }),

  clearCart: () => set({ items: [], discount: 0, customerId: null }),

  restoreCart: (savedItems, savedDiscount) => set({ items: savedItems, discount: savedDiscount, customerId: null }),

  subtotal: () => get().items.reduce((sum, i) => sum + i.total, 0),

  total: () => {
    const subtotal = get().subtotal()
    return Math.max(0, subtotal - get().discount)
  },
}))
