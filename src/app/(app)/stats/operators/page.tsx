import { createClient } from '@/lib/supabase/server'
import OperatorSalesDetailView from '@/components/stats/OperatorSalesDetailView'
import { requireAuthenticatedBusinessId, getBusinessTimezone } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type { OperatorSalesStatsRow } from '@/lib/types'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

export default async function OperatorsDetailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)
  const timezone = await getBusinessTimezone(supabase, businessId)

  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to, timezone)

  const { data: rpcResult, error } = await supabase.rpc('get_sales_by_operator_detail', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`get_sales_by_operator_detail: ${error.message}`)

  const rawRows = (rpcResult as unknown as { data: OperatorSalesStatsRow[] } | null)?.data ?? []
  const rows = normalizeOperatorSalesStatsRows(rawRows)

  return (
    <OperatorSalesDetailView
      rows={rows}
      period={period}
      from={params.from}
      to={params.to}
    />
  )
}
