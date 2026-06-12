import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const rpcMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: rpcMock }),
}))

import { POST } from '@/app/api/catalog/orders/route'

const VALID_UUID = '11111111-2222-3333-4444-555555555555'

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'mi-tienda',
    customer_name: 'Juan',
    phone: '1122334455',
    delivery_type: 'takeaway',
    items: [{ product_id: VALID_UUID, quantity: 2 }],
    ...overrides,
  }
}

let ipCounter = 0
function req(body: unknown, ip?: string): NextRequest {
  // Unique IP per request by default so the in-memory rate limiter doesn't bleed across tests.
  const realIp = ip ?? `10.0.0.${++ipCounter}`
  return new Request('http://localhost/api/catalog/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': realIp },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
})
beforeEach(() => {
  rpcMock.mockReset()
})

describe('POST /api/catalog/orders — input validation', () => {
  it('returns 400 invalid_json for unparseable bodies', async () => {
    const res = await POST(req('{not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('rejects a missing slug', async () => {
    const res = await POST(req(validBody({ slug: '' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_payload')
  })

  it('rejects an over-long customer name', async () => {
    const res = await POST(req(validBody({ customer_name: 'a'.repeat(121) })))
    expect(res.status).toBe(400)
  })

  it('rejects an invalid delivery_type', async () => {
    const res = await POST(req(validBody({ delivery_type: 'teleport' })))
    expect(res.status).toBe(400)
  })

  it('rejects a non-UUID product_id', async () => {
    const res = await POST(req(validBody({ items: [{ product_id: 'not-a-uuid', quantity: 1 }] })))
    expect(res.status).toBe(400)
  })

  it('rejects an empty cart', async () => {
    const res = await POST(req(validBody({ items: [] })))
    expect(res.status).toBe(400)
  })

  it('rejects quantity <= 0 or above the max', async () => {
    expect((await POST(req(validBody({ items: [{ product_id: VALID_UUID, quantity: 0 }] })))).status).toBe(400)
    expect((await POST(req(validBody({ items: [{ product_id: VALID_UUID, quantity: 1001 }] })))).status).toBe(400)
  })

  it('does not call the RPC when the payload is invalid', async () => {
    await POST(req(validBody({ slug: '' })))
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/catalog/orders — RPC success', () => {
  it('returns the created order fields on success', async () => {
    rpcMock.mockResolvedValue({
      data: { success: true, order_id: 'ord-1', order_number: 42, total: 200 },
      error: null,
    })
    const res = await POST(req(validBody()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ order_id: 'ord-1', order_number: 42, total: 200 })
  })

  it('floors fractional quantities before sending to the RPC', async () => {
    rpcMock.mockResolvedValue({ data: { success: true, order_id: 'o', order_number: 1, total: 1 }, error: null })
    await POST(req(validBody({ items: [{ product_id: VALID_UUID, quantity: 2.9 }] })))
    const args = rpcMock.mock.calls[0][1]
    expect(args.p_items[0].quantity).toBe(2)
  })

  it('forwards the client IP to the RPC for forensics', async () => {
    rpcMock.mockResolvedValue({ data: { success: true, order_id: 'o', order_number: 1, total: 1 }, error: null })
    await POST(req(validBody(), '203.0.113.9'))
    expect(rpcMock.mock.calls[0][1].p_client_ip).toBe('203.0.113.9')
  })
})

describe('POST /api/catalog/orders — RPC error mapping', () => {
  it('maps too_many_pending to 429', async () => {
    rpcMock.mockResolvedValue({ data: { success: false, error: 'too_many_pending' }, error: null })
    const res = await POST(req(validBody()))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('too_many_pending')
  })

  it('maps business_not_found to 404', async () => {
    rpcMock.mockResolvedValue({ data: { success: false, error: 'business_not_found' }, error: null })
    expect((await POST(req(validBody()))).status).toBe(404)
  })

  it('maps blacklisted to 403', async () => {
    rpcMock.mockResolvedValue({ data: { success: false, error: 'blacklisted' }, error: null })
    expect((await POST(req(validBody()))).status).toBe(403)
  })

  it('defaults an unknown RPC error code to 400', async () => {
    rpcMock.mockResolvedValue({ data: { success: false, error: 'weird_code' }, error: null })
    expect((await POST(req(validBody()))).status).toBe(400)
  })

  it('returns 500 server_error on a Postgrest error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await POST(req(validBody()))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('server_error')
  })
})

describe('POST /api/catalog/orders — rate limiting', () => {
  it('limits to 5 requests per slug+IP per hour (6th → 429)', async () => {
    rpcMock.mockResolvedValue({ data: { success: true, order_id: 'o', order_number: 1, total: 1 }, error: null })
    const ip = '198.51.100.7'
    const body = validBody({ slug: 'rate-test-shop' })

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await POST(req(body, ip))).status)
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
  })
})
