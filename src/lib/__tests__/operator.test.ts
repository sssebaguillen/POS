import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  parsePermissions,
  normalizePermissions,
  toOperatorManagementPermissions,
  isUserRole,
  parseActiveOperator,
  hasPermission,
  getPermissionLabel,
  getActorOperatorId,
  signOperatorSession,
  getActiveOperator,
  OWNER_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  OPERATOR_MANAGEMENT_PERMISSION_KEYS,
  type ActiveOperator,
  type Permissions,
} from '@/lib/operator'

const TEST_SECRET = 'test-operator-session-secret-please-rotate'

function fullPermissions(overrides: Partial<Permissions> = {}): Permissions {
  return { ...OWNER_PERMISSIONS, ...overrides }
}

function cookieStore(value: string | undefined) {
  return { get: (name: string) => (name === 'operator_session' && value ? { value } : undefined) }
}

// -----------------------------------------------
// Pure permission helpers
// -----------------------------------------------

describe('isUserRole', () => {
  it('accepts owner and the operator roles', () => {
    expect(isUserRole('owner')).toBe(true)
    expect(isUserRole('cashier')).toBe(true)
    expect(isUserRole('manager')).toBe(true)
    expect(isUserRole('custom')).toBe(true)
  })

  it('rejects unknown roles and non-strings', () => {
    expect(isUserRole('admin')).toBe(false)
    expect(isUserRole('')).toBe(false)
    expect(isUserRole(null)).toBe(false)
    expect(isUserRole(123)).toBe(false)
  })
})

describe('parsePermissions', () => {
  // New 8-key shape (current canonical shape)
  const newShape: Permissions = {
    online_orders: true,
    pos_pricing: false,
    inventory_read: true,
    inventory_write: false,
    reports: false,
    expenses: true,
    settings: false,
    manage_operators: false,
  }

  it('parses a valid permission object (new 8-key shape)', () => {
    const result = parsePermissions(newShape)
    expect(result).not.toBeNull()
    expect(result!.online_orders).toBe(true)
    expect(result!.expenses).toBe(true)
    expect(result!.settings).toBe(false)
    expect(result!.pos_pricing).toBe(false)
    expect(result!.manage_operators).toBe(false)
  })

  it('returns null when a required boolean field is missing or wrong-typed', () => {
    expect(parsePermissions({ ...newShape, online_orders: 'yes' })).toBeNull()
    const missing = { ...newShape } as Partial<typeof newShape>
    delete missing.reports
    expect(parsePermissions(missing)).toBeNull()
  })

  it('returns null for non-objects', () => {
    expect(parsePermissions(null)).toBeNull()
    expect(parsePermissions('x')).toBeNull()
    expect(parsePermissions(42)).toBeNull()
  })

  it('returns null for old 11-flag shape (strict — F4 cutover, forces re-login)', () => {
    // The old shape does not have the new keys → parsePermissions returns null
    // (fail-closed: old cookies force operator re-selection)
    const oldShape = {
      sales: true,
      stock: true,
      stock_write: false,
      analysis: false,
      price_lists: true,
      price_lists_write: false,
      settings: false,
      expenses: true,
    }
    expect(parsePermissions(oldShape)).toBeNull()
  })

  it('parses OWNER_PERMISSIONS correctly', () => {
    const result = parsePermissions(OWNER_PERMISSIONS)
    expect(result).not.toBeNull()
    expect(result).toEqual(OWNER_PERMISSIONS)
  })
})

describe('normalizePermissions', () => {
  it('returns all-false for null/undefined', () => {
    expect(normalizePermissions(null)).toEqual(DEFAULT_PERMISSIONS)
    expect(normalizePermissions(undefined)).toEqual(DEFAULT_PERMISSIONS)
  })

  it('coerces only strict-true values to true', () => {
    // New keys: online_orders=true; everything else should be false
    const result = normalizePermissions({ online_orders: true, pos_pricing: false })
    expect(result.online_orders).toBe(true)
    expect(result.pos_pricing).toBe(false)
    expect(result.reports).toBe(false)
    expect(result.manage_operators).toBe(false)
  })

  it('ignores unknown (old) keys without throwing', () => {
    // Old keys are silently ignored; normalizePermissions is lenient (no strict validation)
    const result = normalizePermissions({ sales: true, stock: false, inventory_read: true })
    expect(result.inventory_read).toBe(true)
    // Old key 'sales' is simply not present in the output
    expect((result as unknown as Record<string, unknown>).sales).toBeUndefined()
  })

  it('normalizes OWNER_PERMISSIONS to itself', () => {
    expect(normalizePermissions(OWNER_PERMISSIONS)).toEqual(OWNER_PERMISSIONS)
  })
})

describe('toOperatorManagementPermissions', () => {
  it('projects all 8 management permission keys (new model)', () => {
    const result = toOperatorManagementPermissions(OWNER_PERMISSIONS)
    expect(Object.keys(result).sort()).toEqual([...OPERATOR_MANAGEMENT_PERMISSION_KEYS].sort())
  })

  it('returns all-true for OWNER_PERMISSIONS', () => {
    const result = toOperatorManagementPermissions(OWNER_PERMISSIONS)
    expect(Object.values(result).every(v => v === true)).toBe(true)
  })

  it('returns all-false for DEFAULT_PERMISSIONS', () => {
    const result = toOperatorManagementPermissions(DEFAULT_PERMISSIONS)
    expect(Object.values(result).every(v => v === false)).toBe(true)
  })
})

describe('hasPermission', () => {
  const operator: ActiveOperator = {
    profile_id: 'op-1',
    name: 'Ana',
    role: 'cashier',
    permissions: fullPermissions({ reports: false }),
  }

  it('returns true for a granted permission', () => {
    expect(hasPermission(operator, 'inventory_read')).toBe(true)
  })

  it('returns false for a denied permission', () => {
    expect(hasPermission(operator, 'reports')).toBe(false)
  })

  it('returns true for pos_pricing (replaces old price_override)', () => {
    expect(hasPermission(operator, 'pos_pricing')).toBe(true)
  })
})

describe('getPermissionLabel', () => {
  it('returns the Spanish label for new permission keys', () => {
    expect(getPermissionLabel('inventory_read')).toBe('Ver inventario')
    expect(getPermissionLabel('inventory_write')).toBe('Editar inventario')
    expect(getPermissionLabel('pos_pricing')).toBe('Ajustar precios en la venta')
    expect(getPermissionLabel('online_orders')).toBe('Pedidos online')
    expect(getPermissionLabel('reports')).toBe('Ver reportes y estadísticas')
    expect(getPermissionLabel('expenses')).toBe('Registrar gastos')
    expect(getPermissionLabel('settings')).toBe('Configuración')
    expect(getPermissionLabel('manage_operators')).toBe('Gestionar operarios')
  })

  it('falls back to the raw key when unknown', () => {
    expect(getPermissionLabel('mystery')).toBe('mystery')
    // Old keys fall back to raw string (not silently mapped)
    expect(getPermissionLabel('sales')).toBe('sales')
  })
})

describe('getActorOperatorId', () => {
  it('returns null for the owner (owner has no operators row)', () => {
    const owner: ActiveOperator = {
      profile_id: 'owner-profile',
      name: 'Dueño',
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    }
    expect(getActorOperatorId(owner)).toBeNull()
  })

  it('returns the profile_id for a sub-operator', () => {
    const op: ActiveOperator = {
      profile_id: 'op-1',
      name: 'Ana',
      role: 'cashier',
      permissions: DEFAULT_PERMISSIONS,
    }
    expect(getActorOperatorId(op)).toBe('op-1')
  })

  it('returns null when there is no operator', () => {
    expect(getActorOperatorId(null)).toBeNull()
  })
})

describe('parseActiveOperator', () => {
  const valid = {
    profile_id: 'op-1',
    name: 'Ana',
    role: 'cashier',
    permissions: OWNER_PERMISSIONS,
  }

  it('parses a valid operator object', () => {
    const result = parseActiveOperator(valid)
    expect(result).not.toBeNull()
    expect(result!.profile_id).toBe('op-1')
    expect(result!.role).toBe('cashier')
  })

  it('rejects an invalid role', () => {
    expect(parseActiveOperator({ ...valid, role: 'superadmin' })).toBeNull()
  })

  it('rejects a missing/invalid permissions blob (old shape is invalid)', () => {
    expect(parseActiveOperator({ ...valid, permissions: { sales: true } })).toBeNull()
    expect(parseActiveOperator({ ...valid, permissions: null })).toBeNull()
  })

  it('rejects a non-string profile_id', () => {
    expect(parseActiveOperator({ ...valid, profile_id: 123 })).toBeNull()
  })
})

// -----------------------------------------------
// HMAC-signed operator_session cookie
// This is the only thing constraining a sub-operator's role/permissions, since
// operators ride on the owner's Supabase session. Tampering must invalidate it.
// -----------------------------------------------

describe('operator_session HMAC signing', () => {
  beforeAll(() => {
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET
  })
  afterAll(() => {
    delete process.env.OPERATOR_SESSION_SECRET
  })

  const operator: ActiveOperator = {
    profile_id: 'op-1',
    name: 'Ana',
    role: 'cashier',
    permissions: fullPermissions({ reports: false, manage_operators: false }),
  }

  it('produces a "payload.signature" base64url format', async () => {
    const signed = await signOperatorSession(operator)
    expect(signed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('round-trips: a freshly signed cookie verifies and parses back', async () => {
    const signed = await signOperatorSession(operator)
    const result = await getActiveOperator(cookieStore(signed))
    expect(result).not.toBeNull()
    expect(result!.profile_id).toBe('op-1')
    expect(result!.role).toBe('cashier')
    expect(result!.permissions.inventory_read).toBe(true)
    expect(result!.permissions.reports).toBe(false)
  })

  it('returns null when there is no cookie', async () => {
    expect(await getActiveOperator(cookieStore(undefined))).toBeNull()
  })

  it('rejects an unsigned (legacy plain-JSON) cookie', async () => {
    const plain = JSON.stringify(operator)
    expect(await getActiveOperator(cookieStore(plain))).toBeNull()
  })

  it('rejects a cookie whose payload was tampered for privilege escalation', async () => {
    // Simulate a sub-operator editing the cookie to declare role: 'owner'
    // while keeping the original (now-stale) signature.
    const signed = await signOperatorSession(operator)
    const [payloadB64, sigB64] = signed.split('.')
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const tampered = JSON.parse(payloadJson)
    tampered.role = 'owner'
    tampered.permissions = OWNER_PERMISSIONS
    const tamperedPayload = Buffer.from(JSON.stringify(tampered)).toString('base64url')
    const forgedCookie = `${tamperedPayload}.${sigB64}`

    expect(await getActiveOperator(cookieStore(forgedCookie))).toBeNull()
  })

  it('rejects a cookie signed with a different secret', async () => {
    const signed = await signOperatorSession(operator)
    process.env.OPERATOR_SESSION_SECRET = 'a-completely-different-secret'
    try {
      expect(await getActiveOperator(cookieStore(signed))).toBeNull()
    } finally {
      process.env.OPERATOR_SESSION_SECRET = TEST_SECRET
    }
  })

  it('rejects a cookie with a malformed payload', async () => {
    expect(await getActiveOperator(cookieStore('!!!.@@@'))).toBeNull()
  })
})

describe('operator_session without a configured secret', () => {
  it('throws when OPERATOR_SESSION_SECRET is missing (fail-closed)', async () => {
    const prev = process.env.OPERATOR_SESSION_SECRET
    delete process.env.OPERATOR_SESSION_SECRET
    try {
      await expect(
        signOperatorSession({
          profile_id: 'op-1',
          name: 'Ana',
          role: 'cashier',
          permissions: DEFAULT_PERMISSIONS,
        })
      ).rejects.toThrow(/OPERATOR_SESSION_SECRET/)
    } finally {
      if (prev !== undefined) process.env.OPERATOR_SESSION_SECRET = prev
    }
  })
})
