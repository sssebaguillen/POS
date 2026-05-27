import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// In-memory per-IP rate limiter. Best-effort: each Vercel instance has its own
// memory, so this complements (does not replace) the DB-side anti-spam check
// in create_catalog_order ("3 pending per phone per hour").
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 5
const ipHits = new Map<string, number[]>()

type ItemPayload = {
  product_id: string
  variant_id?: string | null
  quantity: number
}

type Payload = {
  slug: string
  customer_name: string
  phone: string
  delivery_type: 'takeaway' | 'delivery'
  address?: string | null
  notes?: string | null
  items: ItemPayload[]
}

function isPayload(v: unknown): v is Payload {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.slug !== 'string' || !o.slug.trim()) return false
  if (typeof o.customer_name !== 'string' || !o.customer_name.trim()) return false
  if (typeof o.phone !== 'string' || !o.phone.trim()) return false
  if (o.delivery_type !== 'takeaway' && o.delivery_type !== 'delivery') return false
  if (o.address != null && typeof o.address !== 'string') return false
  if (o.notes != null && typeof o.notes !== 'string') return false
  if (!Array.isArray(o.items) || o.items.length === 0) return false
  for (const it of o.items) {
    if (!it || typeof it !== 'object') return false
    const i = it as Record<string, unknown>
    if (typeof i.product_id !== 'string' || !i.product_id) return false
    if (i.variant_id != null && typeof i.variant_id !== 'string') return false
    if (typeof i.quantity !== 'number' || !Number.isFinite(i.quantity) || i.quantity <= 0) return false
  }
  return true
}

function getClientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() ?? null
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return null
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const hits = (ipHits.get(key) ?? []).filter(t => t > cutoff)
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(key, hits)
    return true
  }
  hits.push(now)
  ipHits.set(key, hits)
  return false
}

const RPC_ERROR_TO_HTTP: Record<string, number> = {
  invalid_slug: 400,
  invalid_name: 400,
  invalid_phone: 400,
  invalid_delivery_type: 400,
  address_required: 400,
  empty_cart: 400,
  product_not_available: 400,
  variant_not_available: 400,
  business_not_found: 404,
  blacklisted: 403,
  too_many_pending: 429,
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!isPayload(body)) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  const ip = getClientIp(request)
  const rateKey = `${body.slug}:${ip ?? 'no-ip'}`
  if (isRateLimited(rateKey)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data, error } = await supabase.rpc('create_catalog_order', {
    p_slug: body.slug,
    p_customer_name: body.customer_name,
    p_phone: body.phone,
    p_delivery_type: body.delivery_type,
    p_address: body.address ?? null,
    p_notes: body.notes ?? null,
    p_items: body.items.map(it => ({
      product_id: it.product_id,
      variant_id: it.variant_id ?? null,
      quantity: Math.floor(it.quantity),
    })),
    p_client_ip: ip,
  })

  if (error) {
    console.error('[catalog/orders] RPC error:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  const result = data as { success: boolean; error?: string; order_id?: string; order_number?: number; total?: number } | null
  if (!result?.success) {
    const code = result?.error ?? 'unknown_error'
    const status = RPC_ERROR_TO_HTTP[code] ?? 400
    return NextResponse.json({ error: code }, { status })
  }

  return NextResponse.json({
    order_id: result.order_id,
    order_number: result.order_number,
    total: result.total,
  })
}
