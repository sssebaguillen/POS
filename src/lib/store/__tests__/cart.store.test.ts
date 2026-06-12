import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore, resolveDiscountAmount } from '@/lib/store/cart.store'
import type { Product, ProductVariant } from '@/lib/types'

// --- fixtures ---

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    business_id: 'biz-1',
    category_id: null,
    brand_id: null,
    name: 'Test',
    sku: null,
    barcode: null,
    price: 100,
    cost: 60,
    stock: 10,
    min_stock: 0,
    image_url: null,
    image_source: null,
    is_active: true,
    show_in_catalog: true,
    sales_count: 0,
    has_variants: false,
    created_at: '2024-01-01',
    ...overrides,
  }
}

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'var-1',
    product_id: 'prod-1',
    sku: null,
    barcode: null,
    price: 150,
    cost: 80,
    stock: 5,
    min_stock: 0,
    image_url: null,
    image_source: null,
    is_active: true,
    is_in_stock: true,
    option_values: [],
    ...overrides,
  }
}

// -----------------------------------------------
// resolveDiscountAmount (pure function)
// -----------------------------------------------

describe('resolveDiscountAmount', () => {
  it('returns 0 when discount value is 0', () => {
    expect(resolveDiscountAmount(100, 'fixed', 0)).toBe(0)
  })

  it('returns 0 when subtotal is 0', () => {
    expect(resolveDiscountAmount(0, 'fixed', 50)).toBe(0)
  })

  it('returns 0 when value is negative', () => {
    expect(resolveDiscountAmount(100, 'fixed', -10)).toBe(0)
  })

  describe('percent mode', () => {
    it('computes percentage of subtotal', () => {
      expect(resolveDiscountAmount(200, 'percent', 10)).toBe(20)
    })

    it('handles 50% discount', () => {
      expect(resolveDiscountAmount(100, 'percent', 50)).toBe(50)
    })

    it('clamps to subtotal when percent would exceed it', () => {
      expect(resolveDiscountAmount(100, 'percent', 110)).toBe(100)
    })

    it('rounds to two decimal places', () => {
      // 10% of 33.33 = 3.333 → 3.33
      expect(resolveDiscountAmount(33.33, 'percent', 10)).toBe(3.33)
    })
  })

  describe('fixed mode', () => {
    it('returns the fixed amount', () => {
      expect(resolveDiscountAmount(100, 'fixed', 25)).toBe(25)
    })

    it('clamps to subtotal when amount exceeds total', () => {
      expect(resolveDiscountAmount(100, 'fixed', 150)).toBe(100)
    })

    it('preserves centavo-level precision', () => {
      expect(resolveDiscountAmount(100, 'fixed', 12.99)).toBe(12.99)
    })
  })
})

// -----------------------------------------------
// useCartStore
// -----------------------------------------------

describe('useCartStore', () => {
  beforeEach(() => {
    useCartStore.setState({
      items: [],
      discountMode: 'fixed',
      discountValue: 0,
      customerId: null,
    })
  })

  // --- addItem ---

  describe('addItem', () => {
    it('adds a new product to an empty cart', () => {
      const { addItem } = useCartStore.getState()
      addItem(makeProduct({ price: 100 }))

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].unit_price).toBe(100)
      expect(items[0].quantity).toBe(1)
      expect(items[0].total).toBe(100)
      expect(items[0].priceIsManual).toBeUndefined()
    })

    it('increments quantity when adding the same product again', () => {
      const { addItem } = useCartStore.getState()
      const product = makeProduct({ id: 'prod-1', price: 100 })
      addItem(product)
      addItem(product)

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].quantity).toBe(2)
      expect(items[0].total).toBe(200)
    })

    it('keeps unit_price from initial add when incrementing (no price recalculation)', () => {
      const { addItem } = useCartStore.getState()
      const product = makeProduct({ id: 'prod-1', price: 100 })
      addItem(product)
      addItem(product)

      expect(useCartStore.getState().items[0].unit_price).toBe(100)
    })

    it('adds different products as separate items', () => {
      const { addItem } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      addItem(makeProduct({ id: 'prod-2', price: 50 }))

      expect(useCartStore.getState().items).toHaveLength(2)
    })
  })

  // --- addVariantItem ---

  describe('addVariantItem', () => {
    it('adds a variant item with correct price and metadata', () => {
      const { addVariantItem } = useCartStore.getState()
      const product = makeProduct({ has_variants: true })
      const variant = makeVariant({ price: 150, cost: 80 })
      addVariantItem(product, variant, 'S / Rojo')

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].variant_id).toBe('var-1')
      expect(items[0].variant_label).toBe('S / Rojo')
      expect(items[0].unit_price).toBe(150)
      expect(items[0].variant_cost).toBe(80)
      expect(items[0].variant_base_price).toBe(150)
    })

    it('increments quantity for the same variant', () => {
      const { addVariantItem } = useCartStore.getState()
      const product = makeProduct({ has_variants: true })
      const variant = makeVariant()
      addVariantItem(product, variant, 'S')
      addVariantItem(product, variant, 'S')

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].quantity).toBe(2)
      expect(items[0].total).toBe(300)
    })

    it('treats same product with different variants as separate items', () => {
      const { addVariantItem } = useCartStore.getState()
      const product = makeProduct({ has_variants: true })
      addVariantItem(product, makeVariant({ id: 'var-1', price: 100 }), 'S')
      addVariantItem(product, makeVariant({ id: 'var-2', price: 120 }), 'M')

      expect(useCartStore.getState().items).toHaveLength(2)
    })
  })

  // --- addFreeLineItem ---

  describe('addFreeLineItem', () => {
    it('adds a free-line item as priceIsManual', () => {
      const { addFreeLineItem } = useCartStore.getState()
      addFreeLineItem('fl-1', 'Envío', 50, 1)

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].free_line_id).toBe('fl-1')
      expect(items[0].free_line_description).toBe('Envío')
      expect(items[0].unit_price).toBe(50)
      expect(items[0].quantity).toBe(1)
      expect(items[0].total).toBe(50)
      expect(items[0].priceIsManual).toBe(true)
    })

    it('supports quantity > 1', () => {
      const { addFreeLineItem } = useCartStore.getState()
      addFreeLineItem('fl-1', 'Servicio', 30, 3)

      expect(useCartStore.getState().items[0].total).toBe(90)
    })
  })

  // --- removeItem ---

  describe('removeItem', () => {
    it('removes the correct item by id', () => {
      const { addItem, removeItem } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1' }))
      addItem(makeProduct({ id: 'prod-2' }))
      removeItem('prod-1')

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].product!.id).toBe('prod-2')
    })

    it('no-ops when item id does not exist', () => {
      const { addItem, removeItem } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1' }))
      removeItem('nonexistent')

      expect(useCartStore.getState().items).toHaveLength(1)
    })
  })

  // --- updateQuantity ---

  describe('updateQuantity', () => {
    it('updates quantity and recalculates total', () => {
      const { addItem, updateQuantity } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      updateQuantity('prod-1', 3)

      const { items } = useCartStore.getState()
      expect(items[0].quantity).toBe(3)
      expect(items[0].total).toBe(300)
    })

    it('removes the item when quantity is set to 0', () => {
      const { addItem, updateQuantity } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1' }))
      updateQuantity('prod-1', 0)

      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it('removes the item when quantity is negative', () => {
      const { addItem, updateQuantity } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1' }))
      updateQuantity('prod-1', -1)

      expect(useCartStore.getState().items).toHaveLength(0)
    })
  })

  // --- updatePrice ---

  describe('updatePrice', () => {
    it('updates unit_price, recalculates total, and marks priceIsManual', () => {
      const { addItem, updatePrice } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      updatePrice('prod-1', 80)

      const { items } = useCartStore.getState()
      expect(items[0].unit_price).toBe(80)
      expect(items[0].total).toBe(80)
      expect(items[0].priceIsManual).toBe(true)
    })

    it('recalculates total correctly for quantity > 1', () => {
      const { addItem, updateQuantity, updatePrice } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      updateQuantity('prod-1', 3)
      updatePrice('prod-1', 80)

      expect(useCartStore.getState().items[0].total).toBe(240)
    })
  })

  // --- discount ---

  describe('setDiscount / clearDiscount', () => {
    it('sets fixed discount mode and value', () => {
      const { setDiscount } = useCartStore.getState()
      setDiscount('fixed', 30)

      const state = useCartStore.getState()
      expect(state.discountMode).toBe('fixed')
      expect(state.discountValue).toBe(30)
    })

    it('sets percent discount mode and value', () => {
      const { setDiscount } = useCartStore.getState()
      setDiscount('percent', 15)

      const state = useCartStore.getState()
      expect(state.discountMode).toBe('percent')
      expect(state.discountValue).toBe(15)
    })

    it('resets to fixed 0 on clearDiscount', () => {
      const { setDiscount, clearDiscount } = useCartStore.getState()
      setDiscount('percent', 20)
      clearDiscount()

      const state = useCartStore.getState()
      expect(state.discountMode).toBe('fixed')
      expect(state.discountValue).toBe(0)
    })
  })

  // --- subtotal / discountAmount / total ---

  describe('computed values', () => {
    it('subtotal is the sum of all item totals', () => {
      const { addItem } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      addItem(makeProduct({ id: 'prod-2', price: 50 }))

      expect(useCartStore.getState().subtotal()).toBe(150)
    })

    it('applies fixed discount correctly', () => {
      const { addItem, setDiscount } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      setDiscount('fixed', 25)

      expect(useCartStore.getState().discountAmount()).toBe(25)
      expect(useCartStore.getState().total()).toBe(75)
    })

    it('applies percent discount correctly', () => {
      const { addItem, setDiscount } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 200 }))
      setDiscount('percent', 10)

      expect(useCartStore.getState().discountAmount()).toBe(20)
      expect(useCartStore.getState().total()).toBe(180)
    })

    it('total is never negative (discount is clamped to subtotal)', () => {
      const { addItem, setDiscount } = useCartStore.getState()
      addItem(makeProduct({ id: 'prod-1', price: 100 }))
      setDiscount('fixed', 999)

      expect(useCartStore.getState().discountAmount()).toBe(100)
      expect(useCartStore.getState().total()).toBe(0)
    })

    it('subtotal of empty cart is 0', () => {
      expect(useCartStore.getState().subtotal()).toBe(0)
      expect(useCartStore.getState().discountAmount()).toBe(0)
      expect(useCartStore.getState().total()).toBe(0)
    })
  })

  // --- clearCart ---

  describe('clearCart', () => {
    it('resets items, discount, and customer', () => {
      const { addItem, setDiscount, setCustomer, clearCart } = useCartStore.getState()
      addItem(makeProduct())
      setDiscount('percent', 10)
      setCustomer('cust-1')
      clearCart()

      const state = useCartStore.getState()
      expect(state.items).toHaveLength(0)
      expect(state.discountMode).toBe('fixed')
      expect(state.discountValue).toBe(0)
      expect(state.customerId).toBeNull()
    })
  })

  // --- restoreCart ---

  describe('restoreCart', () => {
    it('restores saved items and discount', () => {
      const { restoreCart } = useCartStore.getState()
      const product = makeProduct({ id: 'prod-saved', price: 200 })
      const savedItems = [{
        product,
        free_line_id: null,
        free_line_description: null,
        variant_id: null,
        variant_label: null,
        quantity: 2,
        unit_price: 200,
        total: 400,
      }]
      restoreCart(savedItems, { mode: 'percent', value: 5 })

      const state = useCartStore.getState()
      expect(state.items).toHaveLength(1)
      expect(state.items[0].product!.id).toBe('prod-saved')
      expect(state.discountMode).toBe('percent')
      expect(state.discountValue).toBe(5)
      expect(state.customerId).toBeNull()
    })
  })
})
