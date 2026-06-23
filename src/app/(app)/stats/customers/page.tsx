export const runtime = 'edge'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId, getBusinessTimezone } from '@/lib/business'
import { getActiveOperator, hasPermission } from '@/lib/operator'
import { resolveDateRange } from '@/lib/date-utils'
import { normalizeCustomerSalesStatsRows } from '@/lib/mappers'
import CustomerSalesDetailView from '@/components/stats/CustomerSalesDetailView'
import type { CustomerSalesStatsRow } from '@/lib/types'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

export default async function CustomersStatsPage({
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

  const timezone = await getBusinessTimezone(supabase, businessId)
  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to, timezone)

  const { data: rpcResult, error } = await supabase.rpc('get_customer_stats', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(`get_customer_stats: ${error.message}`)

  const rawRows = (rpcResult as unknown as { data: CustomerSalesStatsRow[] } | null)?.data ?? []
  const rows = normalizeCustomerSalesStatsRows(rawRows)

  return (
    <CustomerSalesDetailView
      rows={rows}
      period={period}
      from={params.from}
      to={params.to}
    />
  )
}
