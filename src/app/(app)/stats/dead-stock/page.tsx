export const runtime = 'edge'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator, hasPermission } from '@/lib/operator'
import DeadStockView from '@/components/stats/DeadStockView'
import type { DeadStockRow, DeadStockSummary, DeadStockBucket } from '@/lib/types'

interface SearchParams {
  bucket?: string
  page?: string
}

const PAGE_SIZE = 50
const DEAD_DAYS_THRESHOLD = 90
// El stock inmovilizado es un set chico (productos que NO rotan): se traen todas las
// filas marcadas en una sola llamada y el filtro por bucket + paginación viven en el
// cliente (instantáneo, sin round-trip por clic). 500 es el tope de la RPC.
const MAX_ROWS = 500
const ALLOWED_BUCKETS: DeadStockBucket[] = ['never_sold', 'dead']

function parseBucket(value: string | undefined): DeadStockBucket | null {
  return value && ALLOWED_BUCKETS.includes(value as DeadStockBucket)
    ? (value as DeadStockBucket)
    : null
}

function parsePage(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function DeadStockPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  if (activeOperator && !hasPermission(activeOperator, 'analysis')) {
    redirect('/pos')
  }

  const initialBucket = parseBucket(params.bucket)
  const initialPage = parsePage(params.page)

  const { data: rpcResult } = await supabase.rpc('get_dead_stock', {
    p_business_id: businessId,
    p_days_threshold: DEAD_DAYS_THRESHOLD,
    p_bucket: null,
    p_limit: MAX_ROWS,
    p_offset: 0,
  })

  const payload = rpcResult as unknown as {
    data: DeadStockRow[]
    summary: DeadStockSummary
  } | null

  return (
    <DeadStockView
      rows={payload?.data ?? []}
      summary={payload?.summary ?? null}
      bucket={initialBucket}
      page={initialPage}
      pageSize={PAGE_SIZE}
    />
  )
}
