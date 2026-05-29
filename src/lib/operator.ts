export type { UserRole } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import { OPERATOR_ROLES } from '@/lib/constants/domain'

export interface Permissions {
  sales: boolean
  stock: boolean
  stock_write: boolean
  analysis: boolean
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
  analysis: false,
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
  'analysis',
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

export const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  sales: 'Ventas',
  stock: 'Inventario (lectura)',
  stock_write: 'Inventario (edición)',
  analysis: 'Análisis',
  price_lists: 'Listas (lectura)',
  price_lists_write: 'Listas (edición)',
  settings: 'Configuración',
  expenses: 'Gastos',
  operators_write: 'Operarios',
  price_override: 'Override de precio',
  free_line: 'Línea libre',
}

export const OWNER_PERMISSIONS: Permissions = {
  ...DEFAULT_PERMISSIONS,
  sales: true,
  stock: true,
  stock_write: true,
  analysis: true,
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
    typeof record.analysis !== 'boolean' ||
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
    analysis: record.analysis,
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
    analysis: value?.analysis === true,
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
    analysis: permissions.analysis,
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

// --- Firma HMAC de la cookie operator_session -------------------------------
// Los operadores no tienen sesión Supabase propia: montan sobre la del dueño, y
// la cookie operator_session es lo único que restringe su rol/permisos. Sin firma,
// un sub-operador puede editarla en devtools y declararse `role: 'owner'` (httpOnly
// solo bloquea el acceso por JS, no la manipulación por el titular). Por eso se firma
// con HMAC-SHA256 y se verifica server-side. Web Crypto se usa para que funcione tanto
// en edge (proxy, /pos, /dashboard…) como en Node, sin dependencias externas.

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function getOperatorSessionKey(): Promise<CryptoKey> {
  const secret = process.env.OPERATOR_SESSION_SECRET
  if (!secret) {
    throw new Error('Missing OPERATOR_SESSION_SECRET env var (required to sign/verify operator sessions)')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signOperatorSession(operator: ActiveOperator): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(operator))
  const key = await getOperatorSessionKey()
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload))
  return `${bytesToB64url(payload)}.${bytesToB64url(signature)}`
}

export async function getActiveOperator(cookieStore: CookieStoreLike): Promise<ActiveOperator | null> {
  const rawCookie = cookieStore.get('operator_session')

  if (!rawCookie?.value) {
    return null
  }

  const separator = rawCookie.value.indexOf('.')
  if (separator <= 0) {
    // Cookie sin firma (legacy o manipulada): invalidar -> fuerza re-selección de operador.
    return null
  }

  try {
    const payload = b64urlToBytes(rawCookie.value.slice(0, separator))
    const signature = b64urlToBytes(rawCookie.value.slice(separator + 1))
    const key = await getOperatorSessionKey()
    const valid = await crypto.subtle.verify('HMAC', key, signature, payload)
    if (!valid) {
      return null
    }
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown
    return parseActiveOperator(parsed)
  } catch (err) {
    console.error('Failed to verify operator_session cookie:', err)
    return null
  }
}

export function hasPermission(operator: ActiveOperator, permission: keyof Permissions): boolean {
  return operator.permissions[permission] === true
}

export function getPermissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission as keyof Permissions] ?? permission
}

/**
 * Returns the operator id to pass as `p_operator_id` to audit-logged RPCs.
 * Owner actions resolve to `null` so audit_log rows correctly record
 * `operator_id IS NULL` (the "Dueño" sentinel used by get_audit_log).
 */
export function getActorOperatorId(operator: ActiveOperator | null): string | null {
  if (!operator) return null
  return operator.role === 'owner' ? null : operator.profile_id
}
