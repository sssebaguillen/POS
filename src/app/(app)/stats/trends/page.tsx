import { createClient } from '@/lib/supabase/server'
import TrendsDetailView from '@/components/stats/TrendsDetailView'
import { requireAuthenticatedBusinessId, getBusinessTimezone } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'
import type { StatsTrendsComparison } from '@/lib/types'

export const runtime = 'edge'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  metric?: string
}

export default async function TrendsDetailPage({
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

  const { data: rpcResult } = await supabase.rpc('get_period_comparison', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  })

  const emptyTotals = {
    from: from ?? '',
    to: to ?? '',
    net_revenue: 0, gross_revenue: 0, discounts_total: 0,
    expenses_total: 0, operating_expenses_total: 0, inventory_expenses_total: 0,
    sales_count: 0, items_sold: 0, customers_count: 0, avg_ticket: 0,
  }
  const comparison: StatsTrendsComparison = (rpcResult as unknown as StatsTrendsComparison | null) ?? {
    current: emptyTotals,
    previous: emptyTotals,
    days: [],
  }

  return (
    <TrendsDetailView
      businessId={businessId}
      comparison={comparison}
      period={period}
      from={params.from}
      to={params.to}
      timezone={timezone}
      metric={params.metric}
    />
  )
}
