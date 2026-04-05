import type { PriceList, PriceListOverride } from '@/lib/types'

type RelationValue<T> = T | T[] | null | undefined

export function unwrapRelation<T>(value: RelationValue<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

export function normalizePriceList(row: {
  id: string
  business_id: string
  name: string
  description: string | null
  multiplier: number | string
  is_default: boolean
  created_at: string
}): PriceList {
  return {
    id: row.id,
    business_id: row.business_id,
    name: row.name,
    description: row.description,
    multiplier: Number(row.multiplier),
    is_default: row.is_default,
    created_at: row.created_at,
  }
}

export function normalizePriceListOverride(row: {
  id: string
  price_list_id: string
  product_id: string | null
  brand_id: string | null
  multiplier: number | string
}): PriceListOverride {
  return {
    id: row.id,
    price_list_id: row.price_list_id,
    product_id: row.product_id,
    brand_id: row.brand_id,
    multiplier: Number(row.multiplier),
  }
}
