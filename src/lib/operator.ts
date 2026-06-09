export type { UserRole } from '@/lib/types'
import type { UserRole } from '@/lib/types'
import { OPERATOR_ROLES } from '@/lib/constants/domain'

// Modelo de 8 capacidades agrupadas en 4 áreas (Mostrador / Inventario / Reportes /
// Administración). Reemplaza los 11 flags planos viejos. Ver docs/todo/permisos-operario-redesign.md.
export interface Permissions {
  online_orders: boolean
  pos_pricing: boolean
  inventory_read: boolean
  inventory_write: boolean
  reports: boolean
  expenses: boolean
  settings: boolean
  manage_operators: boolean
}

export const DEFAULT_PERMISSIONS: Permissions = {
  online_orders: false,
  pos_pricing: false,
  inventory_read: false,
  inventory_write: false,
  reports: false,
  expenses: false,
  settings: false,
  manage_operators: false,
}

export const OPERATOR_MANAGEMENT_PERMISSION_KEYS = [
  'online_orders',
  'pos_pricing',
  'inventory_read',
  'inventory_write',
  'reports',
  'expenses',
  'settings',
  'manage_operators',
] as const

export type OperatorManagementPermissionKey = (typeof OPERATOR_MANAGEMENT_PERMISSION_KEYS)[number]
export type OperatorManagementPermissions = Pick<Permissions, OperatorManagementPermissionKey>

export const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  online_orders: 'Pedidos online',
  pos_pricing: 'Ajustar precios en la venta',
  inventory_read: 'Ver inventario',
  inventory_write: 'Editar inventario',
  reports: 'Ver reportes y estadísticas',
  expenses: 'Registrar gastos',
  settings: 'Configuración',
  manage_operators: 'Gestionar operarios',
}

export const OWNER_PERMISSIONS: Permissions = {
  online_orders: true,
  pos_pricing: true,
  inventory_read: true,
  inventory_write: true,
  reports: true,
  expenses: true,
  settings: true,
  manage_operators: true,
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

function flag(value: unknown): boolean {
  return value === true
}

/**
 * Normaliza un objeto de permisos al shape canónico de 8 capacidades (clave faltante →
 * false). Espejo TS de la función SQL `normalize_permissions` — mantener ambas en sync
 * (ver regla 11).
 */
export function normalizePermissions(
  value: Record<string, unknown> | Partial<Permissions> | null | undefined
): Permissions {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    online_orders: flag(v.online_orders),
    pos_pricing: flag(v.pos_pricing),
    inventory_read: flag(v.inventory_read),
    inventory_write: flag(v.inventory_write),
    reports: flag(v.reports),
    expenses: flag(v.expenses),
    settings: flag(v.settings),
    manage_operators: flag(v.manage_operators),
  }
}

export function parsePermissions(value: unknown): Permissions | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  // Exigir el shape canónico de 8 keys. Una cookie de shape viejo (11 flags) no las tiene
  // → null → el proxy la limpia y fuerza re-selección de operador. Cutover limpio: nunca
  // degrada permisos en silencio (fail-closed).
  if (!OPERATOR_MANAGEMENT_PERMISSION_KEYS.every(key => typeof record[key] === 'boolean')) {
    return null
  }
  return normalizePermissions(record)
}

export function toOperatorManagementPermissions(
  value: Record<string, unknown> | Partial<Permissions> | null | undefined
): OperatorManagementPermissions {
  return normalizePermissions(value)
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
