import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { POST } from '@/app/api/operator/switch/route'
import { getActiveOperator, OWNER_PERMISSIONS } from '@/lib/operator'

const mockedCreateClient = vi.mocked(createClient)

interface SupabaseConfig {
  user?: { id: string; email?: string } | null
  userError?: { message: string } | null
  signInError?: { message: string } | null
  profile?: Record<string, unknown> | null
  profileError?: { message: string } | null
  verifyData?: unknown
  verifyError?: { message: string } | null
}

function makeSupabase(cfg: SupabaseConfig) {
  return {
    auth: {
      getUser: async () => ({ data: { user: cfg.user ?? null }, error: cfg.userError ?? null }),
      signInWithPassword: async () => ({ error: cfg.signInError ?? null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: cfg.profile ?? null, error: cfg.profileError ?? null }),
        }),
      }),
    }),
    rpc: async () => ({ data: cfg.verifyData ?? null, error: cfg.verifyError ?? null }),
  }
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/operator/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function setSupabase(cfg: SupabaseConfig) {
  mockedCreateClient.mockResolvedValue(makeSupabase(cfg) as never)
}

beforeAll(() => {
  process.env.OPERATOR_SESSION_SECRET = 'switch-route-test-secret'
})
afterAll(() => {
  delete process.env.OPERATOR_SESSION_SECRET
})
beforeEach(() => {
  mockedCreateClient.mockReset()
})

describe('POST /api/operator/switch — request validation', () => {
  it('returns 400 for unparseable JSON', async () => {
    setSupabase({ user: { id: 'u1' } })
    const res = await POST(req('not-json{'))
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBe(false)
  })

  it('returns 400 for a structurally invalid payload', async () => {
    setSupabase({ user: { id: 'u1' } })
    const res = await POST(req({ foo: 'bar' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there is no authenticated user', async () => {
    setSupabase({ user: null })
    const res = await POST(req({ isOwner: true, password: 'x' }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/operator/switch — owner flow', () => {
  it('signs an owner session and sets cookies on a correct password', async () => {
    setSupabase({
      user: { id: 'owner-1', email: 'owner@shop.com' },
      signInError: null,
      profile: { id: 'owner-1', name: 'Dueño' },
    })

    const res = await POST(req({ isOwner: true, password: 'correct-horse' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    // op_perms is the owner's full permission set
    const perms = JSON.parse(res.cookies.get('op_perms')!.value)
    expect(perms).toEqual(OWNER_PERMISSIONS)

    // operator_session is signed and verifies back to an owner
    const signed = res.cookies.get('operator_session')!.value
    const operator = await getActiveOperator({ get: () => ({ value: signed }) })
    expect(operator?.role).toBe('owner')
    expect(operator?.profile_id).toBe('owner-1')
    expect(res.cookies.get('operator_session')!.httpOnly).toBe(true)
  })

  it('returns 401 "Contraseña incorrecta" on a wrong password', async () => {
    setSupabase({
      user: { id: 'owner-1', email: 'owner@shop.com' },
      signInError: { message: 'Invalid login credentials' },
    })
    const res = await POST(req({ isOwner: true, password: 'wrong' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Contraseña incorrecta')
  })
})

describe('POST /api/operator/switch — operator PIN flow', () => {
  // New 8-key permission shape — no analysis/operators_write (old keys)
  const operatorRow = {
    profile_id: 'op-1',
    name: 'Ana',
    role: 'cashier',
    permissions: { ...OWNER_PERMISSIONS, reports: false, manage_operators: false },
  }

  it('rejects a PIN that is not exactly 4 digits', async () => {
    setSupabase({ user: { id: 'u1' }, profile: { business_id: 'biz-1' } })
    const res = await POST(req({ isOwner: false, profile_id: 'op-1', pin: '12' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/4 d/)
  })

  it('signs an operator session on a valid PIN', async () => {
    setSupabase({
      user: { id: 'u1' },
      profile: { business_id: 'biz-1' },
      verifyData: operatorRow,
    })
    const res = await POST(req({ isOwner: false, profile_id: 'op-1', pin: '1234' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ success: true, name: 'Ana', role: 'cashier' })

    const signed = res.cookies.get('operator_session')!.value
    const operator = await getActiveOperator({ get: () => ({ value: signed }) })
    expect(operator?.role).toBe('cashier')
    // New shape: reports replaces old 'analysis'; manage_operators replaces 'operators_write'
    expect(operator?.permissions.reports).toBe(false)
    expect(operator?.permissions.manage_operators).toBe(false)
    expect(operator?.permissions.inventory_read).toBe(true)
  })

  it('accepts the operator row when returned as a single-element array', async () => {
    setSupabase({
      user: { id: 'u1' },
      profile: { business_id: 'biz-1' },
      verifyData: [operatorRow],
    })
    const res = await POST(req({ isOwner: false, profile_id: 'op-1', pin: '1234' }))
    expect(res.status).toBe(200)
  })

  it('surfaces the lockout error from verify_operator_pin', async () => {
    setSupabase({
      user: { id: 'u1' },
      profile: { business_id: 'biz-1' },
      verifyData: { success: false, locked: true, error: 'Demasiados intentos. Probá en 15 minutos.' },
    })
    const res = await POST(req({ isOwner: false, profile_id: 'op-1', pin: '9999' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Demasiados intentos. Probá en 15 minutos.')
  })

  it('returns 400 when the business_id cannot be resolved', async () => {
    setSupabase({ user: { id: 'u1' }, profile: { business_id: null } })
    const res = await POST(req({ isOwner: false, profile_id: 'op-1', pin: '1234' }))
    expect(res.status).toBe(400)
  })
})
