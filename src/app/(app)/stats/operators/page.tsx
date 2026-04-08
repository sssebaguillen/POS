import { createClient } from '@/lib/supabase/server'
import OperatorSalesDetailView from '@/components/stats/OperatorSalesDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'

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
  const from = params.from
  const to = params.to

  const { data: rpcResult } = await supabase.rpc('get_sales_by_operator_detail', {
    p_business_id: businessId,
    p_from: from ?? null,
    p_to: to ?? null,
  })

  const rows = (rpcResult as unknown as { data: OperatorSalesRow[] } | null)?.data ?? []

  return (
    <OperatorSalesDetailView
      rows={rows}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
    />
  )
}

interface OperatorSalesRow {
  operator_id: string | null
  operator_name: string
  role: string
  transactions: number
  total_revenue: number
  avg_ticket: number
  units_sold: number
}
