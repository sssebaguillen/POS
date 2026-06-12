import { describe, it, expect } from 'vitest'
import {
  applyRounding,
  calculateProductPrice,
  resolveDisplayPrice,
  resolveCartItemPrice,
  getMarginPercent,
} from '@/lib/price-lists'
import type { CartItem, PriceList, PriceListOverride, Product } from '@/lib/types'

// --- fixtures ---

function makeList(overrides: Partial<PriceList> = {}): PriceList {
  return {
    id: 'list-1',
    business_id: 'biz-1',
    name: 'Mayorista',
    description: null,
    multiplier: 2,
    rounding_step: null,
    rounding_up: false,
    created_at: '2024-01-01',
    ...overrides,
  }
}

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

function makeCartItem(product: Product | null, overrides: Partial<CartItem> = {}): CartItem {
  return {
    product,
    free_line_id: null,
    free_line_description: null,
    variant_id: null,
    variant_label: null,
    quantity: 1,
    unit_price: product?.price ?? 0,
    total: product?.price ?? 0,
    ...overrides,
  }
}

const NO_OVERRIDES: PriceListOverride[] = []

// -----------------------------------------------
// applyRounding
// -----------------------------------------------

describe('applyRounding', () => {
  it('returns value unchanged when step is null', () => {
    expect(applyRounding(148.5, null, false)).toBe(148.5)
  })

  it('returns value unchanged when step is 0', () => {
    expect(applyRounding(148.5, 0, false)).toBe(148.5)
  })

  it('rounds to nearest integer (step=1)', () => {
    expect(applyRounding(4.4, 1, false)).toBe(4)
    expect(applyRounding(4.5, 1, false)).toBe(5)
  })

  it('rounds up to next integer (step=1, up=true)', () => {
    expect(applyRounding(4.0, 1, true)).toBe(4)
    expect(applyRounding(4.1, 1, true)).toBe(5)
  })

  it('rounds to nearest multiple of 5', () => {
    expect(applyRounding(12, 5, false)).toBe(10)
    expect(applyRounding(13, 5, false)).toBe(15)
    expect(applyRounding(148.5, 5, false)).toBe(150)
  })

  it('rounds up to next multiple of 10', () => {
    expect(applyRounding(100, 10, true)).toBe(100)
    expect(applyRounding(101, 10, true)).toBe(110)
    expect(applyRounding(151.5, 10, true)).toBe(160)
  })

  it('rounds to nearest multiple of 50', () => {
    expect(applyRounding(124, 50, false)).toBe(100)
    expect(applyRounding(125, 50, false)).toBe(150)
  })
})

// -----------------------------------------------
// calculateProductPrice
// Key rule: multiplier applies ONLY when cost > 0.
// When cost = 0, uses explicit price (variantPrice > 0 wins, else base price).
// -----------------------------------------------

describe('calculateProductPrice', () => {
  const list = makeList({ multiplier: 2, rounding_step: null, rounding_up: false })

  describe('cost = 0 — multiplier does NOT apply', () => {
    it('returns variantPrice when variantPrice > 0', () => {
      expect(calculateProductPrice(0, 100, 'p', null, list, NO_OVERRIDES, 250)).toBe(250)
    })

    it('returns base price when variantPrice is null', () => {
      expect(calculateProductPrice(0, 100, 'p', null, list, NO_OVERRIDES, null)).toBe(100)
    })

    it('returns base price when variantPrice is 0 (zero is not a valid explicit price)', () => {
      expect(calculateProductPrice(0, 100, 'p', null, list, NO_OVERRIDES, 0)).toBe(100)
    })

    it('returns base price when variantPrice is omitted', () => {
      expect(calculateProductPrice(0, 100, 'p', null, list, NO_OVERRIDES)).toBe(100)
    })
  })

  describe('cost > 0 — list multiplier applies', () => {
    it('applies list multiplier: cost × multiplier', () => {
      // 60 × 2 = 120
      expect(calculateProductPrice(60, 100, 'p', null, list, NO_OVERRIDES)).toBe(120)
    })

    it('list multiplier takes precedence over base price', () => {
      // cost=100, multiplier=2 → 200, even though price=50
      expect(calculateProductPrice(100, 50, 'p', null, list, NO_OVERRIDES)).toBe(200)
    })
  })

  describe('overrides', () => {
    it('applies product-level override multiplier', () => {
      const overrides: PriceListOverride[] = [
        { id: 'o1', price_list_id: 'list-1', product_id: 'p', brand_id: null, multiplier: 3 },
      ]
      // cost=100 × 3 = 300
      expect(calculateProductPrice(100, 0, 'p', 'brand-1', list, overrides)).toBe(300)
    })

    it('applies brand-level override when no product override exists', () => {
      const overrides: PriceListOverride[] = [
        { id: 'o2', price_list_id: 'list-1', product_id: null, brand_id: 'brand-1', multiplier: 2.5 },
      ]
      // cost=100 × 2.5 = 250
      expect(calculateProductPrice(100, 0, 'p', 'brand-1', list, overrides)).toBe(250)
    })

    it('product override wins over brand override', () => {
      const overrides: PriceListOverride[] = [
        { id: 'o1', price_list_id: 'list-1', product_id: 'p', brand_id: null, multiplier: 3 },
        { id: 'o2', price_list_id: 'list-1', product_id: null, brand_id: 'brand-1', multiplier: 9 },
      ]
      expect(calculateProductPrice(100, 0, 'p', 'brand-1', list, overrides)).toBe(300)
    })

    it('ignores overrides belonging to a different price list', () => {
      const overrides: PriceListOverride[] = [
        { id: 'o3', price_list_id: 'other-list', product_id: 'p', brand_id: null, multiplier: 10 },
      ]
      expect(calculateProductPrice(100, 0, 'p', null, list, overrides)).toBe(200)
    })

    it('ignores brand override when brandId is null', () => {
      const overrides: PriceListOverride[] = [
        { id: 'o4', price_list_id: 'list-1', product_id: null, brand_id: 'brand-1', multiplier: 9 },
      ]
      // product has no brand, so brand override is skipped → falls back to list.multiplier=2
      expect(calculateProductPrice(100, 0, 'p', null, list, overrides)).toBe(200)
    })
  })

  describe('rounding applied to computed price', () => {
    it('rounds result to nearest multiple of 5', () => {
      const listWithRounding = makeList({ multiplier: 1.5, rounding_step: 5, rounding_up: false })
      // 100 × 1.5 = 150 → nearest 5 = 150
      expect(calculateProductPrice(100, 0, 'p', null, listWithRounding, NO_OVERRIDES)).toBe(150)
      // 99 × 1.5 = 148.5 → nearest 5 = 150
      expect(calculateProductPrice(99, 0, 'p', null, listWithRounding, NO_OVERRIDES)).toBe(150)
      // 97 × 1.5 = 145.5 → nearest 5 = 145 (round)
      expect(calculateProductPrice(97, 0, 'p', null, listWithRounding, NO_OVERRIDES)).toBe(145)
    })

    it('rounds up when rounding_up=true', () => {
      const listUp = makeList({ multiplier: 1.5, rounding_step: 10, rounding_up: true })
      // 99 × 1.5 = 148.5 → ceil to next 10 = 150
      expect(calculateProductPrice(99, 0, 'p', null, listUp, NO_OVERRIDES)).toBe(150)
      // 101 × 1.5 = 151.5 → ceil to next 10 = 160
      expect(calculateProductPrice(101, 0, 'p', null, listUp, NO_OVERRIDES)).toBe(160)
    })
  })
})

// -----------------------------------------------
// resolveDisplayPrice
// When priceList=null: returns product/variant price directly (no multiplier).
// When priceList is active: delegates to calculateProductPrice.
// -----------------------------------------------

describe('resolveDisplayPrice', () => {
  describe('no active price list — catalog and default cart behavior', () => {
    it('returns base price', () => {
      expect(resolveDisplayPrice({
        cost: 60, price: 100, productId: 'p', brandId: null,
        priceList: null, overrides: NO_OVERRIDES,
      })).toBe(100)
    })

    it('returns variantPrice when variantPrice > 0', () => {
      expect(resolveDisplayPrice({
        cost: 60, price: 100, productId: 'p', brandId: null,
        priceList: null, overrides: NO_OVERRIDES, variantPrice: 150,
      })).toBe(150)
    })

    it('returns base price when variantPrice is 0', () => {
      expect(resolveDisplayPrice({
        cost: 60, price: 100, productId: 'p', brandId: null,
        priceList: null, overrides: NO_OVERRIDES, variantPrice: 0,
      })).toBe(100)
    })

    it('never applies a multiplier even when cost > 0', () => {
      // Base price is always used as-is when no list is active
      expect(resolveDisplayPrice({
        cost: 60, price: 100, productId: 'p', brandId: null,
        priceList: null, overrides: NO_OVERRIDES,
      })).toBe(100)
    })
  })

  describe('active price list', () => {
    const list = makeList({ multiplier: 2, rounding_step: null, rounding_up: false })

    it('applies multiplier when cost > 0', () => {
      // 60 × 2 = 120
      expect(resolveDisplayPrice({
        cost: 60, price: 100, productId: 'p', brandId: null,
        priceList: list, overrides: NO_OVERRIDES,
      })).toBe(120)
    })

    it('returns base price (not multiplied) when cost = 0', () => {
      expect(resolveDisplayPrice({
        cost: 0, price: 100, productId: 'p', brandId: null,
        priceList: list, overrides: NO_OVERRIDES,
      })).toBe(100)
    })

    it('returns variantPrice when cost = 0 and variantPrice > 0', () => {
      expect(resolveDisplayPrice({
        cost: 0, price: 100, productId: 'p', brandId: null,
        priceList: list, overrides: NO_OVERRIDES, variantPrice: 250,
      })).toBe(250)
    })
  })
})

// -----------------------------------------------
// resolveCartItemPrice
// Cart default: unit_price is used as-is unless a price list is explicitly active.
// priceIsManual always bypasses the list regardless.
// -----------------------------------------------

describe('resolveCartItemPrice', () => {
  const list = makeList({ multiplier: 2, rounding_step: null, rounding_up: false })
  const product = makeProduct({ price: 100, cost: 60 })

  it('returns unit_price for free-line items (no product attached)', () => {
    const item: CartItem = {
      product: null,
      free_line_id: 'fl-1',
      free_line_description: 'Servicio personalizado',
      variant_id: null,
      variant_label: null,
      quantity: 1,
      unit_price: 75,
      total: 75,
      priceIsManual: true,
    }
    expect(resolveCartItemPrice({ item, priceList: list, overrides: NO_OVERRIDES })).toBe(75)
  })

  it('returns unit_price when priceIsManual=true, even with an active price list', () => {
    const item = makeCartItem(product, { unit_price: 999, priceIsManual: true })
    expect(resolveCartItemPrice({ item, priceList: list, overrides: NO_OVERRIDES })).toBe(999)
  })

  it('returns unit_price when no price list is active (default cart behavior)', () => {
    const item = makeCartItem(product, { unit_price: 100 })
    expect(resolveCartItemPrice({ item, priceList: null, overrides: NO_OVERRIDES })).toBe(100)
  })

  it('applies list multiplier to regular product when list is active', () => {
    const item = makeCartItem(product, { unit_price: 100 })
    // cost=60 × multiplier=2 = 120
    expect(resolveCartItemPrice({ item, priceList: list, overrides: NO_OVERRIDES })).toBe(120)
  })

  it('uses variant cost and base price for variant items', () => {
    const item: CartItem = {
      ...makeCartItem(product),
      variant_id: 'var-1',
      variant_label: 'S',
      variant_cost: 50,
      variant_base_price: 90,
      unit_price: 90,
    }
    // variant cost=50 × multiplier=2 = 100
    expect(resolveCartItemPrice({ item, priceList: list, overrides: NO_OVERRIDES })).toBe(100)
  })

  it('returns variant base price when variant cost = 0, even with an active list', () => {
    const item: CartItem = {
      ...makeCartItem(product),
      variant_id: 'var-1',
      variant_label: 'S',
      variant_cost: 0,
      variant_base_price: 90,
      unit_price: 90,
    }
    // cost=0, variantPrice=90 > 0 → variantPrice wins, no multiplier
    expect(resolveCartItemPrice({ item, priceList: list, overrides: NO_OVERRIDES })).toBe(90)
  })
})

// -----------------------------------------------
// getMarginPercent
// -----------------------------------------------

describe('getMarginPercent', () => {
  it('returns 0 for a 1× multiplier (no markup)', () => {
    expect(getMarginPercent(1)).toBe(0)
  })

  it('returns 50 for a 1.5× multiplier', () => {
    expect(getMarginPercent(1.5)).toBe(50)
  })

  it('returns 100 for a 2× multiplier', () => {
    expect(getMarginPercent(2)).toBe(100)
  })

  it('rounds fractional margins', () => {
    expect(getMarginPercent(1.235)).toBe(24)
  })
})
