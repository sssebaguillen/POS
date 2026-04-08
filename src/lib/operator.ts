export type { UserRole } from '@/lib/types'
import type { UserRole } from '@/lib/types'

export interface Permissions {
  sales: boolean
  stock: boolean
  stock_write: boolean
  stats: boolean
  price_lists: boolean
  price_lists_write: boolean
  settings: boolean
  expenses: boolean
  price_override: boolean
}

export const OWNER_PERMISSIONS: Permissions = {
  sales: true,
  stock: true,
  stock_write: true,
  stats: true,
  price_lists: true,
  price_lists_write: true,
  settings: true,
  expenses: true,
  price_override: true,
}

export interface ActiveOperator {
  profile_id: string
  name: string
  role: UserRole
  permissions: Permissions
}

interface CookieLike {
  value: string
}

export interface CookieStoreLike {
  get: (name: string) => CookieLike | undefined
}

export function parsePermissions(value: unknown): Permissions | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.sales !== 'boolean' ||
    typeof record.stock !== 'boolean' ||
    typeof record.stock_write !== 'boolean' ||
    typeof record.stats !== 'boolean' ||
    typeof record.price_lists !== 'boolean' ||
    typeof record.price_lists_write !== 'boolean' ||
    typeof record.settings !== 'boolean' ||
    typeof record.expenses !== 'boolean'
  ) {
    return null
  }

  return {
    sales: record.sales,
    stock: record.stock,
    stock_write: record.stock_write,
    stats: record.stats,
    price_lists: record.price_lists,
    price_lists_write: record.price_lists_write,
    settings: record.settings,
    expenses: record.expenses,
    // Soft default: old cookies without this field stay valid (defaults to false)
    price_override: record.price_override === true,
  }
}

export function normalizePermissions(value: Partial<Permissions> | null | undefined): Permissions {
  return {
    sales: value?.sales === true,
    stock: value?.stock === true,
    stock_write: value?.stock_write === true,
    stats: value?.stats === true,
    price_lists: value?.price_lists === true,
    price_lists_write: value?.price_lists_write === true,
    settings: value?.settings === true,
    expenses: value?.expenses === true,
    price_override: value?.price_override === true,
  }
}

export function isUserRole(value: unknown): value is UserRole {
  return value === 'owner' || value === 'manager' || value === 'cashier' || value === 'custom'
}

export function parseActiveOperator(value: unknown): ActiveOperator | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const permissions = parsePermissions(record.permissions)

  if (
    typeof record.profile_id !== 'string' ||
    typeof record.name !== 'string' ||
    !isUserRole(record.role) ||
    !permissions
  ) {
    return null
  }

  return {
    profile_id: record.profile_id,
    name: record.name,
    role: record.role,
    permissions,
  }
}

export function getActiveOperator(cookieStore: CookieStoreLike): ActiveOperator | null {
  const rawCookie = cookieStore.get('operator_session')

  if (!rawCookie?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(rawCookie.value) as unknown
    return parseActiveOperator(parsed)
  } catch (err) {
    console.error('Failed to parse operator_session cookie:', err)
    return null
  }
}

export function hasPermission(operator: ActiveOperator, permission: keyof Permissions): boolean {
  return operator.permissions[permission] === true
}
