import { createClient } from '@/lib/supabase/server'
import OperatorSalesDetailView from '@/components/stats/OperatorSalesDetailView'
import type { OperatorSalesRow } from '@/components/stats/OperatorSalesDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'

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

  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to)

  const { data: rpcResult } = await supabase.rpc('get_sales_by_operator_detail', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  })

  const rows = (rpcResult as unknown as { data: OperatorSalesRow[] } | null)?.data ?? []

  return (
    <OperatorSalesDetailView
      rows={rows}
      period={period}
      from={params.from}
      to={params.to}
    />
  )
}
