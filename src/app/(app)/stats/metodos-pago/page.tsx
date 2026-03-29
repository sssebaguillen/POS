import { createClient } from '@/lib/supabase/server'
import PaymentMethodDetailView from '@/components/stats/PaymentMethodDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

export default async function MetodosPagoDetailPage({
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

  const { data: rpcResult } = await supabase.rpc('get_sales_by_payment_detail', {
    p_business_id: businessId,
    p_from: from ?? null,
    p_to: to ?? null,
  })

  const rows = (rpcResult as unknown as { data: PaymentMethodRow[] } | null)?.data ?? []

  return (
    <PaymentMethodDetailView
      rows={rows}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
    />
  )
}

interface PaymentMethodRow {
  method: string
  total_amount: number
  transactions: number
  avg_ticket: number
}
