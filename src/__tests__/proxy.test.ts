import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUserMock = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}))

import { proxy } from '@/proxy'
import { signOperatorSession, OWNER_PERMISSIONS, DEFAULT_PERMISSIONS, type ActiveOperator } from '@/lib/operator'

beforeAll(() => {
  process.env.OPERATOR_SESSION_SECRET = 'proxy-test-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
})
afterAll(() => {
  delete process.env.OPERATOR_SESSION_SECRET
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
})
beforeEach(() => {
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
})

function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(`http://localhost${path}`))
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value)
  }
  return req
}

async function operatorCookie(overrides: Partial<ActiveOperator> = {}): Promise<string> {
  const operator: ActiveOperator = {
    profile_id: 'op-1',
    name: 'Cajero Test',
    role: 'cashier',
    permissions: { ...DEFAULT_PERMISSIONS },
    ...overrides,
  }
  return signOperatorSession(operator)
}

function locationOf(res: Response): string {
  return new URL(res.headers.get('location') ?? 'http://localhost/__none__').pathname
}

// El valor de cookie que devuelve NextResponse ya viene decodificado; el
// decodeURIComponent extra es no-op sobre JSON plano (sin %), robusto en ambos casos.
function cookieJson(res: { cookies: { get: (n: string) => { value: string } | undefined } }, name: string): unknown {
  const raw = res.cookies.get(name)?.value
  if (raw == null) return undefined
  return JSON.parse(decodeURIComponent(raw))
}

// -----------------------------------------------
// Autenticación y sesión
// -----------------------------------------------

describe('proxy — auth & session routing', () => {
  it('redirige a /login cuando no hay usuario', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await proxy(makeRequest('/pos'))
    expect(res.status).toBe(307)
    expect(locationOf(res)).toBe('/login')
  })

  it('deja pasar el catálogo público sin usuario (con CSP)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await proxy(makeRequest('/catalogo/tienda'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
  })

  it('redirige a /pos cuando un usuario logueado entra a una ruta de auth', async () => {
    const res = await proxy(makeRequest('/login'))
    expect(locationOf(res)).toBe('/pos')
  })

  it('sin cookie de operador → /operator-select y limpia cookies', async () => {
    const res = await proxy(makeRequest('/pos'))
    expect(locationOf(res)).toBe('/operator-select')
    expect(res.cookies.get('operator_session')?.value).toBe('')
    expect(res.cookies.get('op_perms')?.value).toBe('')
  })

  it('cookie de operador manipulada → /operator-select (firma rechazada)', async () => {
    const valid = await operatorCookie()
    const tampered = valid.slice(0, -2) + 'xx'
    const res = await proxy(makeRequest('/pos', { operator_session: tampered }))
    expect(locationOf(res)).toBe('/operator-select')
    expect(res.cookies.get('operator_session')?.value).toBe('')
  })

  it('owner → pasa y setea op_perms = OWNER_PERMISSIONS', async () => {
    const cookie = await operatorCookie({ role: 'owner', permissions: { ...OWNER_PERMISSIONS } })
    const res = await proxy(makeRequest('/settings', { operator_session: cookie }))
    expect(res.headers.get('location')).toBeNull()
    expect(cookieJson(res, 'op_perms')).toEqual(OWNER_PERMISSIONS)
  })
})

// -----------------------------------------------
// Gates de permiso por ruta (operador no-owner)
// -----------------------------------------------

describe('proxy — permission gates', () => {
  it('/profile es owner-only → redirige a /pos con flash_toast', async () => {
    const cookie = await operatorCookie()
    const res = await proxy(makeRequest('/profile', { operator_session: cookie }))
    expect(locationOf(res)).toBe('/pos')
    expect(res.cookies.get('flash_toast')?.value).toBe('no-access')
  })

  it('/expenses sin permiso expenses → /pos', async () => {
    const cookie = await operatorCookie()
    const res = await proxy(makeRequest('/expenses', { operator_session: cookie }))
    expect(locationOf(res)).toBe('/pos')
  })

  it('/stats sin permiso reports → /pos (gate compartido con /dashboard, /activity)', async () => {
    const cookie = await operatorCookie()
    const res = await proxy(makeRequest('/stats', { operator_session: cookie }))
    expect(locationOf(res)).toBe('/pos')
  })

  it('/inventory sin permiso inventory_read → /pos (gate compartido con /price-lists, /promotions)', async () => {
    const cookie = await operatorCookie()
    const res = await proxy(makeRequest('/inventory', { operator_session: cookie }))
    expect(locationOf(res)).toBe('/pos')
  })

  it('/settings sin permiso settings → /pos', async () => {
    const cookie = await operatorCookie()
    const res = await proxy(makeRequest('/settings', { operator_session: cookie }))
    expect(locationOf(res)).toBe('/pos')
  })

  it('/orders sin permiso online_orders → /pos', async () => {
    const cookie = await operatorCookie()
    const res = await proxy(makeRequest('/orders', { operator_session: cookie }))
    expect(locationOf(res)).toBe('/pos')
  })

  it('/expenses CON permiso expenses → pasa y op_perms refleja el permiso', async () => {
    const cookie = await operatorCookie({ permissions: { ...DEFAULT_PERMISSIONS, expenses: true } })
    const res = await proxy(makeRequest('/expenses', { operator_session: cookie }))
    expect(res.headers.get('location')).toBeNull()
    expect(cookieJson(res, 'op_perms')).toMatchObject({ expenses: true })
  })

  it('/operator-select con operador activo redirige por rol', async () => {
    const manager = await operatorCookie({ role: 'manager' })
    const resManager = await proxy(makeRequest('/operator-select', { operator_session: manager }))
    expect(locationOf(resManager)).toBe('/dashboard')

    const cashier = await operatorCookie({ role: 'cashier' })
    const resCashier = await proxy(makeRequest('/operator-select', { operator_session: cashier }))
    expect(locationOf(resCashier)).toBe('/pos')
  })
})
