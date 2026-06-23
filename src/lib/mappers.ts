import type { CustomerSalesStatsRow, OperatorSalesStatsRow, PriceList, PriceListOverride, ProductWithVariants, UserRole } from '@/lib/types'
import { isUserRole } from '@/lib/operator'

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
  created_at: string
  rounding_step?: number | string | null
  rounding_up?: boolean | null
}): PriceList {
  return {
    id: row.id,
    business_id: row.business_id,
    name: row.name,
    description: row.description,
    multiplier: Number(row.multiplier),
    created_at: row.created_at,
    rounding_step:
      row.rounding_step == null || row.rounding_step === '' ? null : Number(row.rounding_step),
    rounding_up: row.rounding_up ?? false,
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

/**
 * get_product_with_variants devuelve {success:true, product, options, variants}
 * o {success:false, error}. Este guard es el ÚNICO punto de narrowing — castear
 * el resultado directo a ProductWithVariants crashea en el shape de error.
 */
export function unwrapProductWithVariants(rpc: unknown): ProductWithVariants | null {
  if (!rpc || typeof rpc !== 'object') return null
  if ((rpc as { success?: boolean }).success !== true) return null
  return rpc as unknown as ProductWithVariants
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

interface CustomerSalesStatsRowInput {
  customer_id?: unknown
  customer_name?: unknown
  customer_phone?: unknown
  credit_balance?: unknown
  transactions?: unknown
  transaction_count?: unknown
  total_revenue?: unknown
  revenue?: unknown
  avg_ticket?: unknown
  units_sold?: unknown
  last_purchase_at?: unknown
}

export function normalizeCustomerSalesStatsRows(value: unknown): CustomerSalesStatsRow[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((row): row is CustomerSalesStatsRowInput => row !== null && typeof row === 'object')
    .map(row => ({
      customer_id: typeof row.customer_id === 'string' ? row.customer_id : '',
      customer_name:
        typeof row.customer_name === 'string' && row.customer_name.trim().length > 0
          ? row.customer_name
          : 'Sin nombre',
      customer_phone: typeof row.customer_phone === 'string' ? row.customer_phone : null,
      credit_balance: Number(row.credit_balance ?? 0),
      transactions: Number(row.transactions ?? row.transaction_count ?? 0),
      total_revenue: Number(row.total_revenue ?? row.revenue ?? 0),
      avg_ticket: Number(row.avg_ticket ?? 0),
      units_sold: Number(row.units_sold ?? 0),
      last_purchase_at: typeof row.last_purchase_at === 'string' ? row.last_purchase_at : null,
    }))
    .filter(row => row.customer_id !== '')
}
