import { describe, it, expect } from 'vitest'
import {
  isPromotionLive,
  findApplicablePromo,
  applyUnitPromo,
  computeQuantityDiscount,
  resolvePromoLine,
  promoBadgeLabel,
  promoCountdownLabel,
  type Promotion,
} from '@/lib/promotions'

// ---------------------------------------------------------------------------
// Test helper — builds a Promotion with sensible defaults.
// Use `at` param (Date) to control "now" in time-sensitive functions.
// ---------------------------------------------------------------------------

function makePromo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    business_id: 'biz-1',
    name: 'Promo Test',
    kind: 'percent',
    percent: 20,
    offer_price: null,
    group_size: null,
    affected_units: null,
    pay_percent: null,
    product_id: null,
    category_id: null,
    brand_id: null,
    starts_at: null,
    ends_at: null,
    is_active: true,
    show_in_catalog: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const NOW = new Date('2026-06-12T12:00:00Z')
const YESTERDAY = new Date('2026-06-11T12:00:00Z')
const TOMORROW = new Date('2026-06-13T12:00:00Z')

// ---------------------------------------------------------------------------
// isPromotionLive
// ---------------------------------------------------------------------------

describe('isPromotionLive', () => {
  it('returns true for an active promo with no date constraints', () => {
    expect(isPromotionLive(makePromo(), NOW)).toBe(true)
  })

  it('returns false when is_active is false', () => {
    expect(isPromotionLive(makePromo({ is_active: false }), NOW)).toBe(false)
  })

  it('returns false when archived_at is set (archived promo)', () => {
    expect(isPromotionLive(makePromo({ archived_at: '2026-06-01T00:00:00Z' }), NOW)).toBe(false)
  })

  it('returns false when starts_at is in the future', () => {
    expect(isPromotionLive(makePromo({ starts_at: TOMORROW.toISOString() }), NOW)).toBe(false)
  })

  it('returns false when ends_at is in the past', () => {
    expect(isPromotionLive(makePromo({ ends_at: YESTERDAY.toISOString() }), NOW)).toBe(false)
  })

  it('returns true when starts_at is in the past and ends_at is in the future', () => {
    expect(
      isPromotionLive(
        makePromo({ starts_at: YESTERDAY.toISOString(), ends_at: TOMORROW.toISOString() }),
        NOW
      )
    ).toBe(true)
  })

  it('returns false when both inactive and archived', () => {
    expect(isPromotionLive(makePromo({ is_active: false, archived_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findApplicablePromo
// ---------------------------------------------------------------------------

describe('findApplicablePromo', () => {
  const productPromo = makePromo({
    id: 'product-promo',
    product_id: 'prod-1',
    category_id: null,
    brand_id: null,
    created_at: '2026-01-01T00:00:00Z',
  })
  const categoryPromo = makePromo({
    id: 'category-promo',
    product_id: null,
    category_id: 'cat-1',
    brand_id: null,
    created_at: '2026-01-01T00:00:00Z',
  })
  const brandPromo = makePromo({
    id: 'brand-promo',
    product_id: null,
    category_id: null,
    brand_id: 'brand-1',
    created_at: '2026-01-01T00:00:00Z',
  })

  it('returns null when promotions is empty', () => {
    const result = findApplicablePromo({
      promotions: [],
      productId: 'prod-1',
      categoryId: 'cat-1',
      brandId: 'brand-1',
      at: NOW,
    })
    expect(result).toBeNull()
  })

  it('returns null when no promo matches the product/category/brand', () => {
    const result = findApplicablePromo({
      promotions: [brandPromo],
      productId: 'prod-99',
      categoryId: 'cat-99',
      brandId: 'brand-99',
      at: NOW,
    })
    expect(result).toBeNull()
  })

  it('product-level promo wins over category-level (higher specificity)', () => {
    const result = findApplicablePromo({
      promotions: [categoryPromo, productPromo, brandPromo],
      productId: 'prod-1',
      categoryId: 'cat-1',
      brandId: 'brand-1',
      at: NOW,
    })
    expect(result?.id).toBe('product-promo')
  })

  it('category-level promo wins over brand-level', () => {
    const result = findApplicablePromo({
      promotions: [brandPromo, categoryPromo],
      productId: 'prod-99', // no product match
      categoryId: 'cat-1',
      brandId: 'brand-1',
      at: NOW,
    })
    expect(result?.id).toBe('category-promo')
  })

  it('brand-level promo wins when no product or category match', () => {
    const result = findApplicablePromo({
      promotions: [brandPromo],
      productId: 'prod-99',
      categoryId: null,
      brandId: 'brand-1',
      at: NOW,
    })
    expect(result?.id).toBe('brand-promo')
  })

  it('at equal specificity, the more recent promo wins (higher created_at)', () => {
    const older = makePromo({ id: 'old-cat', category_id: 'cat-1', created_at: '2026-01-01T00:00:00Z' })
    const newer = makePromo({ id: 'new-cat', category_id: 'cat-1', created_at: '2026-06-01T00:00:00Z' })
    const result = findApplicablePromo({
      promotions: [older, newer],
      productId: 'prod-99',
      categoryId: 'cat-1',
      brandId: null,
      at: NOW,
    })
    expect(result?.id).toBe('new-cat')
  })

  it('ignores inactive promos', () => {
    const inactive = makePromo({ id: 'inactive', product_id: 'prod-1', is_active: false })
    const result = findApplicablePromo({
      promotions: [inactive],
      productId: 'prod-1',
      categoryId: null,
      brandId: null,
      at: NOW,
    })
    expect(result).toBeNull()
  })

  it('ignores archived promos', () => {
    const archived = makePromo({ id: 'archived', product_id: 'prod-1', archived_at: '2026-06-01T00:00:00Z' })
    const result = findApplicablePromo({
      promotions: [archived],
      productId: 'prod-1',
      categoryId: null,
      brandId: null,
      at: NOW,
    })
    expect(result).toBeNull()
  })

  it('ignores promos that have not started yet', () => {
    const future = makePromo({ id: 'future', product_id: 'prod-1', starts_at: TOMORROW.toISOString() })
    const result = findApplicablePromo({
      promotions: [future],
      productId: 'prod-1',
      categoryId: null,
      brandId: null,
      at: NOW,
    })
    expect(result).toBeNull()
  })

  it('ignores expired promos', () => {
    const expired = makePromo({ id: 'expired', product_id: 'prod-1', ends_at: YESTERDAY.toISOString() })
    const result = findApplicablePromo({
      promotions: [expired],
      productId: 'prod-1',
      categoryId: null,
      brandId: null,
      at: NOW,
    })
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applyUnitPromo
// ---------------------------------------------------------------------------

describe('applyUnitPromo', () => {
  it('applies a percent promo: 20% off 150 → 120', () => {
    const promo = makePromo({ kind: 'percent', percent: 20 })
    expect(applyUnitPromo(promo, 150)).toBe(120)
  })

  it('rounds to 2 decimal places: 33% of 10 → 6.7', () => {
    const promo = makePromo({ kind: 'percent', percent: 33 })
    expect(applyUnitPromo(promo, 10)).toBe(6.7)
  })

  it('applies offer_price when below current price: offer 80 on 100 → 80', () => {
    const promo = makePromo({ kind: 'offer_price', offer_price: 80, percent: null })
    expect(applyUnitPromo(promo, 100)).toBe(80)
  })

  it('offer_price never raises price: offer 120 on 100 → 100 (min clamp)', () => {
    const promo = makePromo({ kind: 'offer_price', offer_price: 120, percent: null })
    expect(applyUnitPromo(promo, 100)).toBe(100)
  })

  it('quantity kind does not touch the unit price', () => {
    const promo = makePromo({ kind: 'quantity', percent: null, group_size: 2, affected_units: 1, pay_percent: 0 })
    expect(applyUnitPromo(promo, 100)).toBe(100)
  })

  it('percent=null → no discount applied', () => {
    const promo = makePromo({ kind: 'percent', percent: null })
    expect(applyUnitPromo(promo, 100)).toBe(100)
  })

  it('offer_price=null → no discount applied', () => {
    const promo = makePromo({ kind: 'offer_price', offer_price: null, percent: null })
    expect(applyUnitPromo(promo, 100)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// computeQuantityDiscount (N/K/P model)
// ---------------------------------------------------------------------------

describe('computeQuantityDiscount', () => {
  // 2x1: buy 2, get 1 free (N=2, K=1, P=0 → pay 0% of 1 unit)
  const twoForOne = makePromo({ kind: 'quantity', group_size: 2, affected_units: 1, pay_percent: 0 })

  it('2x1: qty=1 → 0 (below group threshold)', () => {
    expect(computeQuantityDiscount(twoForOne, 100, 1)).toBe(0)
  })

  it('2x1: qty=2 → 100 (one unit free)', () => {
    expect(computeQuantityDiscount(twoForOne, 100, 2)).toBe(100)
  })

  it('2x1: qty=3 → 100 (only one complete group of 2)', () => {
    expect(computeQuantityDiscount(twoForOne, 100, 3)).toBe(100)
  })

  it('2x1: qty=4 → 200 (two complete groups)', () => {
    expect(computeQuantityDiscount(twoForOne, 100, 4)).toBe(200)
  })

  // 3x2: buy 3, pay for 2 (N=3, K=1, P=0)
  it('3x2: qty=3 → 100 (one unit free per group of 3)', () => {
    const threeForTwo = makePromo({ kind: 'quantity', group_size: 3, affected_units: 1, pay_percent: 0 })
    expect(computeQuantityDiscount(threeForTwo, 100, 3)).toBe(100)
  })

  // 2nd item at 50% (N=2, K=1, P=50): discount = floor(qty/2)*1*price*(1-50/100)
  it('2nd item at 50%: qty=2 → unit×0.5', () => {
    const secondAt50 = makePromo({ kind: 'quantity', group_size: 2, affected_units: 1, pay_percent: 50 })
    expect(computeQuantityDiscount(secondAt50, 100, 2)).toBe(50)
  })

  it('2nd item at 50%: qty=4 → 100 (two groups)', () => {
    const secondAt50 = makePromo({ kind: 'quantity', group_size: 2, affected_units: 1, pay_percent: 50 })
    expect(computeQuantityDiscount(secondAt50, 100, 4)).toBe(100)
  })

  it('returns 0 when N < 2 (degenerate promo)', () => {
    const bad = makePromo({ kind: 'quantity', group_size: 1, affected_units: 1, pay_percent: 0 })
    expect(computeQuantityDiscount(bad, 100, 5)).toBe(0)
  })

  it('returns 0 when N is null', () => {
    const bad = makePromo({ kind: 'quantity', group_size: null, affected_units: 1, pay_percent: 0 })
    expect(computeQuantityDiscount(bad, 100, 5)).toBe(0)
  })

  it('returns 0 when K < 1 (no affected units)', () => {
    const bad = makePromo({ kind: 'quantity', group_size: 2, affected_units: 0, pay_percent: 0 })
    expect(computeQuantityDiscount(bad, 100, 5)).toBe(0)
  })

  it('returns 0 when K is null', () => {
    const bad = makePromo({ kind: 'quantity', group_size: 2, affected_units: null, pay_percent: 0 })
    expect(computeQuantityDiscount(bad, 100, 5)).toBe(0)
  })

  it('returns 0 when unitPrice is 0', () => {
    expect(computeQuantityDiscount(twoForOne, 0, 5)).toBe(0)
  })

  it('returns 0 when kind is not quantity', () => {
    const percentPromo = makePromo({ kind: 'percent', percent: 20 })
    expect(computeQuantityDiscount(percentPromo, 100, 5)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// resolvePromoLine
// ---------------------------------------------------------------------------

describe('resolvePromoLine', () => {
  it('unit promo: lowers unitPrice, computes promoDiscount per qty', () => {
    const promo = makePromo({ id: 'p1', kind: 'percent', percent: 20 })
    const result = resolvePromoLine({ promo, unitPrice: 100, quantity: 3 })
    expect(result.unitPrice).toBe(80)
    expect(result.originalUnitPrice).toBe(100)
    expect(result.promoDiscount).toBe(60) // 3 × (100 - 80)
    expect(result.promotionId).toBe('p1')
  })

  it('quantity promo: unitPrice stays intact, promoDiscount at line level', () => {
    const promo = makePromo({
      id: 'q1',
      kind: 'quantity',
      group_size: 2,
      affected_units: 1,
      pay_percent: 0,
      percent: null,
    })
    // qty=2, 2x1: discount = 1 unit free = 100
    const result = resolvePromoLine({ promo, unitPrice: 100, quantity: 2 })
    expect(result.unitPrice).toBe(100) // unchanged
    expect(result.promoDiscount).toBe(100)
    expect(result.promotionId).toBe('q1')
    expect(result.originalUnitPrice).toBe(100)
  })

  it('returns none when promo is null', () => {
    const result = resolvePromoLine({ promo: null, unitPrice: 100, quantity: 3 })
    expect(result.promotionId).toBeNull()
    expect(result.promoDiscount).toBe(0)
    expect(result.unitPrice).toBe(100)
  })

  it('returns none when unitPrice is 0', () => {
    const promo = makePromo({ kind: 'percent', percent: 20 })
    const result = resolvePromoLine({ promo, unitPrice: 0, quantity: 3 })
    expect(result.promotionId).toBeNull()
    expect(result.promoDiscount).toBe(0)
  })

  it('returns none when quantity is 0', () => {
    const promo = makePromo({ kind: 'percent', percent: 20 })
    const result = resolvePromoLine({ promo, unitPrice: 100, quantity: 0 })
    expect(result.promotionId).toBeNull()
    expect(result.promoDiscount).toBe(0)
  })

  it('returns none when quantity is negative', () => {
    const promo = makePromo({ kind: 'percent', percent: 20 })
    const result = resolvePromoLine({ promo, unitPrice: 100, quantity: -1 })
    expect(result.promotionId).toBeNull()
  })

  it('returns none when the unit promo does not cheapen (offer_price >= price)', () => {
    // offer_price=120 on unitPrice=100 → applyUnitPromo returns 100 (clamped), promoUnit >= unitPrice → none
    const promo = makePromo({ kind: 'offer_price', offer_price: 120, percent: null })
    const result = resolvePromoLine({ promo, unitPrice: 100, quantity: 2 })
    expect(result.promotionId).toBeNull()
    expect(result.promoDiscount).toBe(0)
    expect(result.unitPrice).toBe(100)
  })

  it('quantity promo below group threshold → none', () => {
    const promo = makePromo({ kind: 'quantity', group_size: 2, affected_units: 1, pay_percent: 0, percent: null })
    // qty=1 is below N=2 → discount=0 → none
    const result = resolvePromoLine({ promo, unitPrice: 100, quantity: 1 })
    expect(result.promotionId).toBeNull()
    expect(result.promoDiscount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// promoBadgeLabel
// ---------------------------------------------------------------------------

describe('promoBadgeLabel', () => {
  it('percent kind: -20%', () => {
    expect(promoBadgeLabel(makePromo({ kind: 'percent', percent: 20 }))).toBe('-20%')
  })

  it('offer_price kind: Oferta', () => {
    expect(promoBadgeLabel(makePromo({ kind: 'offer_price', offer_price: 80, percent: null }))).toBe('Oferta')
  })

  it('2x1 (N=2, K=1, P=0): 2x1', () => {
    expect(
      promoBadgeLabel(makePromo({ kind: 'quantity', group_size: 2, affected_units: 1, pay_percent: 0 }))
    ).toBe('2x1')
  })

  it('3x2 (N=3, K=1, P=0): 3x2', () => {
    expect(
      promoBadgeLabel(makePromo({ kind: 'quantity', group_size: 3, affected_units: 1, pay_percent: 0 }))
    ).toBe('3x2')
  })

  it('2nd unit at 50% (N=2, K=1, P=50): 2da un. -50%', () => {
    expect(
      promoBadgeLabel(makePromo({ kind: 'quantity', group_size: 2, affected_units: 1, pay_percent: 50 }))
    ).toBe('2da un. -50%')
  })

  it('generic N×(N-K) case (N=4, K=2, P=0): 4x2', () => {
    expect(
      promoBadgeLabel(makePromo({ kind: 'quantity', group_size: 4, affected_units: 2, pay_percent: 0 }))
    ).toBe('4x2')
  })
})

// ---------------------------------------------------------------------------
// promoCountdownLabel
// ---------------------------------------------------------------------------

describe('promoCountdownLabel', () => {
  it('returns null when endsAt is null', () => {
    expect(promoCountdownLabel(null, NOW)).toBeNull()
  })

  it('returns null when ends_at is already past', () => {
    expect(promoCountdownLabel(YESTERDAY.toISOString(), NOW)).toBeNull()
  })

  it('returns "Termina hoy" when ends_at is the same day (after now)', () => {
    // 1 hour from now, same day
    const endsAtSameDay = new Date(NOW.getTime() + 3_600_000)
    expect(promoCountdownLabel(endsAtSameDay.toISOString(), NOW)).toBe('Termina hoy')
  })

  it('returns "Termina mañana" when ends_at is exactly 1 day away', () => {
    const endsAtTomorrow = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 12, 0, 0)
    expect(promoCountdownLabel(endsAtTomorrow.toISOString(), NOW)).toBe('Termina mañana')
  })

  it('returns "Termina en N días" for 2–7 days away', () => {
    const endsIn3 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 3, 12, 0, 0)
    expect(promoCountdownLabel(endsIn3.toISOString(), NOW)).toBe('Termina en 3 días')
  })

  it('returns null when ends_at is more than 7 days away', () => {
    const endsIn10 = new Date(NOW.getTime() + 10 * 86_400_000)
    expect(promoCountdownLabel(endsIn10.toISOString(), NOW)).toBeNull()
  })
})
