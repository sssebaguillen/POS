import type { OperatorSalesStatsRow, PriceList, PriceListOverride, UserRole } from '@/lib/types'

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

interface OperatorSalesStatsRowInput {
  operator_id?: string | null
  operator_name?: string | null
  role?: unknown
  operator_role?: unknown
  transactions?: unknown
  transaction_count?: unknown
  total_revenue?: unknown
  revenue?: unknown
  avg_ticket?: unknown
  units_sold?: unknown
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'owner' || value === 'manager' || value === 'cashier' || value === 'custom'
}

function normalizeOperatorRole(input: OperatorSalesStatsRowInput, operatorId: string | null): UserRole {
  if (isUserRole(input.role)) {
    return input.role
  }

  if (isUserRole(input.operator_role)) {
    return input.operator_role
  }

  if (operatorId === null) {
    return 'owner'
  }

  return 'custom'
}

export function normalizeOperatorSalesStatsRows(value: unknown): OperatorSalesStatsRow[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((row): row is OperatorSalesStatsRowInput => row !== null && typeof row === 'object')
    .map(row => {
      const rawOperatorId = typeof row.operator_id === 'string' ? row.operator_id : null
      const operatorId = rawOperatorId && rawOperatorId !== 'unknown' ? rawOperatorId : null
      const role = normalizeOperatorRole(row, operatorId)
      const operatorName =
        typeof row.operator_name === 'string' && row.operator_name.trim().length > 0
          ? row.operator_name
          : role === 'owner'
            ? 'Dueño'
            : 'Sin nombre'

      return {
        operator_id: operatorId,
        operator_name: role === 'owner' ? 'Dueño' : operatorName,
        role,
        transactions: Number(row.transactions ?? row.transaction_count ?? 0),
        total_revenue: Number(row.total_revenue ?? row.revenue ?? 0),
        avg_ticket: Number(row.avg_ticket ?? 0),
        units_sold: Number(row.units_sold ?? 0),
      }
    })
}
