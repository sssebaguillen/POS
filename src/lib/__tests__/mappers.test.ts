import { describe, it, expect } from 'vitest'
import {
  unwrapRelation,
  normalizePriceList,
  normalizePriceListOverride,
  normalizeOperatorSalesStatsRows,
  unwrapProductWithVariants,
} from '@/lib/mappers'

describe('unwrapProductWithVariants', () => {
  it('devuelve el objeto cuando success es true', () => {
    const ok = { success: true, product: { id: 'p1' }, options: [], variants: [] }
    expect(unwrapProductWithVariants(ok)).toBe(ok)
  })
  it('devuelve null para el shape de error {success:false}', () => {
    expect(unwrapProductWithVariants({ success: false, error: 'Product not found' })).toBeNull()
  })
  it('devuelve null para null/undefined', () => {
    expect(unwrapProductWithVariants(null)).toBeNull()
    expect(unwrapProductWithVariants(undefined)).toBeNull()
  })
  it('devuelve null para basura sin success', () => {
    expect(unwrapProductWithVariants({ product: {} })).toBeNull()
    expect(unwrapProductWithVariants('texto')).toBeNull()
  })
})

describe('unwrapRelation', () => {
  it('returns the first element of an array', () => {
    expect(unwrapRelation([{ id: 1 }, { id: 2 }])).toEqual({ id: 1 })
  })

  it('returns null for an empty array', () => {
    expect(unwrapRelation([])).toBeNull()
  })

  it('returns the value itself when not an array', () => {
    expect(unwrapRelation({ id: 1 })).toEqual({ id: 1 })
  })

  it('returns null for null/undefined', () => {
    expect(unwrapRelation(null)).toBeNull()
    expect(unwrapRelation(undefined)).toBeNull()
  })
})

describe('normalizePriceList', () => {
  const base = {
    id: 'pl-1',
    business_id: 'biz-1',
    name: 'Mayorista',
    description: null,
    multiplier: 2,
    created_at: '2026-01-01',
  }

  it('coerces a string multiplier to a number', () => {
    const result = normalizePriceList({ ...base, multiplier: '1.5' })
    expect(result.multiplier).toBe(1.5)
    expect(typeof result.multiplier).toBe('number')
  })

  it('defaults rounding_up to false when absent', () => {
    expect(normalizePriceList(base).rounding_up).toBe(false)
  })

  it('treats empty-string rounding_step as null', () => {
    expect(normalizePriceList({ ...base, rounding_step: '' }).rounding_step).toBeNull()
  })

  it('treats null rounding_step as null', () => {
    expect(normalizePriceList({ ...base, rounding_step: null }).rounding_step).toBeNull()
  })

  it('coerces a string rounding_step to a number', () => {
    expect(normalizePriceList({ ...base, rounding_step: '5' }).rounding_step).toBe(5)
  })

  it('preserves rounding_up when provided', () => {
    expect(normalizePriceList({ ...base, rounding_up: true }).rounding_up).toBe(true)
  })
})

describe('normalizePriceListOverride', () => {
  it('coerces multiplier to a number and preserves ids', () => {
    const result = normalizePriceListOverride({
      id: 'o1',
      price_list_id: 'pl-1',
      product_id: 'p-1',
      brand_id: null,
      multiplier: '3',
    })
    expect(result).toEqual({
      id: 'o1',
      price_list_id: 'pl-1',
      product_id: 'p-1',
      brand_id: null,
      multiplier: 3,
    })
  })
})

describe('normalizeOperatorSalesStatsRows', () => {
  it('returns an empty array for non-array input', () => {
    expect(normalizeOperatorSalesStatsRows(null)).toEqual([])
    expect(normalizeOperatorSalesStatsRows(undefined)).toEqual([])
    expect(normalizeOperatorSalesStatsRows('nope')).toEqual([])
  })

  it('filters out null/non-object rows', () => {
    expect(normalizeOperatorSalesStatsRows([null, 5, 'x'])).toEqual([])
  })

  it('labels owner rows (null operator_id) as "Dueño" with role owner', () => {
    const [row] = normalizeOperatorSalesStatsRows([
      { operator_id: null, transactions: 3, total_revenue: 1000 },
    ])
    expect(row.role).toBe('owner')
    expect(row.operator_name).toBe('Dueño')
    expect(row.operator_id).toBeNull()
  })

  it('treats the sentinel operator_id "unknown" as owner', () => {
    const [row] = normalizeOperatorSalesStatsRows([{ operator_id: 'unknown' }])
    expect(row.operator_id).toBeNull()
    expect(row.role).toBe('owner')
  })

  it('keeps a real operator id and defaults its role to custom', () => {
    const [row] = normalizeOperatorSalesStatsRows([
      { operator_id: 'op-1', operator_name: 'Ana' },
    ])
    expect(row.operator_id).toBe('op-1')
    expect(row.operator_name).toBe('Ana')
    expect(row.role).toBe('custom')
  })

  it('respects an explicit role field', () => {
    const [row] = normalizeOperatorSalesStatsRows([
      { operator_id: 'op-1', operator_name: 'Ana', role: 'manager' },
    ])
    expect(row.role).toBe('manager')
  })

  it('falls back to "Sin nombre" for an unnamed non-owner', () => {
    const [row] = normalizeOperatorSalesStatsRows([{ operator_id: 'op-1' }])
    expect(row.operator_name).toBe('Sin nombre')
  })

  it('coerces numeric fields and supports alternate field names', () => {
    const [row] = normalizeOperatorSalesStatsRows([
      {
        operator_id: 'op-1',
        operator_name: 'Ana',
        transaction_count: '7',
        revenue: '2500',
        avg_ticket: '357.14',
        units_sold: '12',
      },
    ])
    expect(row.transactions).toBe(7)
    expect(row.total_revenue).toBe(2500)
    expect(row.avg_ticket).toBeCloseTo(357.14)
    expect(row.units_sold).toBe(12)
  })
})
