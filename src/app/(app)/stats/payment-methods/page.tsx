import { createClient } from '@/lib/supabase/server'
import PaymentMethodDetailView from '@/components/stats/PaymentMethodDetailView'
import type { PaymentMethodRow } from '@/components/stats/PaymentMethodDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange } from '@/lib/date-utils'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

export default async function PaymentMethodsDetailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period = params.period ?? 'mes'
  const { from, to } = resolveDateRange(period, params.from, params.to)

  const { data: rpcResult } = await supabase.rpc('get_sales_by_payment_detail', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  })

  const rows = (rpcResult as unknown as { data: PaymentMethodRow[] } | null)?.data ?? []

  return (
    <PaymentMethodDetailView
      rows={rows}
      period={period}
      from={params.from}
      to={params.to}
    />
  )
}
