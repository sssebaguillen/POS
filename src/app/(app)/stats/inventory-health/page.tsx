export const runtime = 'edge'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator, hasPermission } from '@/lib/operator'
import InventoryHealthView from '@/components/stats/InventoryHealthView'
import type {
  DeadStockRow, DeadStockSummary, DeadStockBucket,
  OverstockRow, OverstockSummary, InventoryHealthLens,
} from '@/lib/types'

interface SearchParams {
  lens?: string
  bucket?: string
  page?: string
}

const PAGE_SIZE = 50
const DEAD_DAYS_THRESHOLD = 90
// Ambas lentes son sets chicos (productos que no rotan / sobrestock): se traen completas
// en una sola llamada cada una y el filtro/paginación viven en el cliente (cambio de
// lente y de chip instantáneos, sin round-trip). 500 es el tope de cada RPC.
const MAX_ROWS = 500
const ALLOWED_BUCKETS: DeadStockBucket[] = ['never_sold', 'dead']

function parseLens(value: string | undefined): InventoryHealthLens {
  return value === 'overstock' ? 'overstock' : 'dead'
}

function parseBucket(value: string | undefined): DeadStockBucket | null {
  return value && ALLOWED_BUCKETS.includes(value as DeadStockBucket)
    ? (value as DeadStockBucket)
    : null
}

function parsePage(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function InventoryHealthPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  if (activeOperator && !hasPermission(activeOperator, 'reports')) {
    redirect('/pos')
  }

  const lens = parseLens(params.lens)
  const bucket = parseBucket(params.bucket)
  const page = parsePage(params.page)

  const [{ data: deadRaw, error: deadError }, { data: overstockRaw, error: overstockError }] = await Promise.all([
    supabase.rpc('get_dead_stock', {
      p_business_id: businessId,
      p_days_threshold: DEAD_DAYS_THRESHOLD,
      p_bucket: null,
      p_limit: MAX_ROWS,
      p_offset: 0,
    }),
    supabase.rpc('get_overstock', {
      p_business_id: businessId,
      p_limit: MAX_ROWS,
      p_offset: 0,
    }),
  ])
  if (deadError) throw new Error(`get_dead_stock: ${deadError.message}`)
  if (overstockError) throw new Error(`get_overstock: ${overstockError.message}`)

  const deadPayload = deadRaw as unknown as {
    data: DeadStockRow[]
    summary: DeadStockSummary
  } | null

  const overstockPayload = overstockRaw as unknown as {
    data: OverstockRow[]
    summary: OverstockSummary
  } | null

  return (
    <InventoryHealthView
      deadRows={deadPayload?.data ?? []}
      deadSummary={deadPayload?.summary ?? null}
      overstockRows={overstockPayload?.data ?? []}
      overstockSummary={overstockPayload?.summary ?? null}
      lens={lens}
      bucket={bucket}
      page={page}
      pageSize={PAGE_SIZE}
    />
  )
}
