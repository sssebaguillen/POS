import { createClient } from '@/lib/supabase/server'
import SalesHeatmapView from '@/components/stats/SalesHeatmapView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'
import type { SalesHeatmapCell } from '@/lib/types'

export const runtime = 'edge'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  metric?: string
}

export default async function SalesHeatmapPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to)

  const { data: rpcResult } = await supabase.rpc('get_sales_heatmap', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  })

  const cells = (rpcResult as unknown as { data: SalesHeatmapCell[] } | null)?.data ?? []

  return (
    <SalesHeatmapView
      businessId={businessId}
      cells={cells}
      period={period}
      from={params.from}
      to={params.to}
      metric={params.metric}
    />
  )
}
