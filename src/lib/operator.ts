export type { UserRole } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import { OPERATOR_ROLES } from '@/lib/constants/domain'

export interface Permissions {
  sales: boolean
  stock: boolean
  stock_write: boolean
  stats: boolean
  price_lists: boolean
  price_lists_write: boolean
  settings: boolean
  expenses: boolean
  operators_write: boolean
  price_override: boolean
  free_line: boolean
}

export const DEFAULT_PERMISSIONS: Permissions = {
  sales: false,
  stock: false,
  stock_write: false,
  stats: false,
  price_lists: false,
  price_lists_write: false,
  settings: false,
  expenses: false,
  operators_write: false,
  price_override: false,
  free_line: false,
}

export const OPERATOR_MANAGEMENT_PERMISSION_KEYS = [
  'sales',
  'stock',
  'stock_write',
  'stats',
  'price_lists',
  'price_lists_write',
  'expenses',
  'settings',
  'operators_write',
  'price_override',
  'free_line',
] as const

export type OperatorManagementPermissionKey = (typeof OPERATOR_MANAGEMENT_PERMISSION_KEYS)[number]
export type OperatorManagementPermissions = Pick<Permissions, OperatorManagementPermissionKey>

export const OWNER_PERMISSIONS: Permissions = {
  ...DEFAULT_PERMISSIONS,
  sales: true,
  stock: true,
  stock_write: true,
  stats: true,
  price_lists: true,
  price_lists_write: true,
  settings: true,
  expenses: true,
  operators_write: true,
  price_override: true,
  free_line: true,
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
    ...DEFAULT_PERMISSIONS,
    sales: record.sales,
    stock: record.stock,
    stock_write: record.stock_write,
    stats: record.stats,
    price_lists: record.price_lists,
    price_lists_write: record.price_lists_write,
    settings: record.settings,
    expenses: record.expenses,
    operators_write: record.operators_write === true,
    // Soft defaults: old cookies without these fields stay valid (default to false)
    price_override: record.price_override === true,
    free_line: record.free_line === true,
  }
}

export function normalizePermissions(value: Partial<Permissions> | null | undefined): Permissions {
  return {
    ...DEFAULT_PERMISSIONS,
    sales: value?.sales === true,
    stock: value?.stock === true,
    stock_write: value?.stock_write === true,
    stats: value?.stats === true,
    price_lists: value?.price_lists === true,
    price_lists_write: value?.price_lists_write === true,
    settings: value?.settings === true,
    expenses: value?.expenses === true,
    operators_write: value?.operators_write === true,
    price_override: value?.price_override === true,
    free_line: value?.free_line === true,
  }
}

export function toOperatorManagementPermissions(
  value: Partial<Permissions> | null | undefined
): OperatorManagementPermissions {
  const permissions = normalizePermissions(value)

  return {
    sales: permissions.sales,
    stock: permissions.stock,
    stock_write: permissions.stock_write,
    stats: permissions.stats,
    price_lists: permissions.price_lists,
    price_lists_write: permissions.price_lists_write,
    expenses: permissions.expenses,
    settings: permissions.settings,
    operators_write: permissions.operators_write,
    price_override: permissions.price_override,
    free_line: permissions.free_line,
  }
}

export function isUserRole(value: unknown): value is UserRole {
  return value === 'owner' || (OPERATOR_ROLES as readonly string[]).includes(value as string)
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
