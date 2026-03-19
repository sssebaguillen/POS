export type UserRole = 'owner' | 'manager' | 'cashier' | 'custom'

export interface Permissions {
  sales: boolean
  stock: boolean
  stock_write: boolean
  stats: boolean
  price_lists: boolean
  price_lists_write: boolean
  settings: boolean
  expenses: boolean
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

interface CookieStoreLike {
  get: (name: string) => CookieLike | undefined
}

function isPermissions(value: unknown): value is Permissions {
  if (!value || typeof value !== 'object') {
    return false
  }

  const p = value as Record<string, unknown>
  return (
    typeof p.sales === 'boolean' &&
    typeof p.stock === 'boolean' &&
    typeof p.stock_write === 'boolean' &&
    typeof p.stats === 'boolean' &&
    typeof p.price_lists === 'boolean' &&
    typeof p.price_lists_write === 'boolean' &&
    typeof p.settings === 'boolean'
  )
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'owner' || value === 'manager' || value === 'cashier' || value === 'custom'
}

function parseOperator(value: unknown): ActiveOperator | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>

  if (
    typeof record.profile_id !== 'string' ||
    typeof record.name !== 'string' ||
    !isUserRole(record.role) ||
    !isPermissions(record.permissions)
  ) {
    return null
  }

  return {
    profile_id: record.profile_id,
    name: record.name,
    role: record.role,
    permissions: record.permissions,
  }
}

export function getActiveOperator(cookieStore: CookieStoreLike): ActiveOperator | null {
  const rawCookie = cookieStore.get('operator_session')

  if (!rawCookie?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(rawCookie.value) as unknown
    return parseOperator(parsed)
  } catch {
    return null
  }
}

export function hasPermission(operator: ActiveOperator, permission: keyof Permissions): boolean {
  return operator.permissions[permission] === true
}
