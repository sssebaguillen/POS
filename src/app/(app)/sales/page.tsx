import { createClient } from '@/lib/supabase/server'
import SalesHistoryView, { type Period } from '@/components/sales/SalesHistoryView'

function getDateRange(period: Period, from: string, to: string): { start: Date; end: Date } {
  const now = new Date()

  if (period === 'hoy') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (period === 'semana') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (period === 'personalizado' && from && to) {
    const start = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T23:59:59.999`)
    return { start, end }
  }

  // mes (default)
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const rawPeriod = params.period ?? ''
  const period: Period = (['hoy', 'semana', 'mes', 'personalizado'] as Period[]).includes(rawPeriod as Period)
    ? (rawPeriod as Period)
    : 'mes'
  const from = params.from ?? ''
  const to = params.to ?? ''

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let businessId: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()
    businessId = profile?.business_id ?? null
  }

  if (!businessId) {
    return <p className="p-8 text-sm text-hint">No se pudo cargar el negocio.</p>
  }

  const { start, end } = getDateRange(period, from, to)

  const { data: sales } = await supabase
    .from('sales')
    .select('id, total, status, created_at')
    .eq('business_id', businessId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .order('created_at', { ascending: false })
    .limit(500)

  const saleIds = (sales ?? []).map(s => s.id)

  let paymentsBySaleId: Record<string, string> = {}
  if (saleIds.length > 0) {
    const { data: payments } = await supabase
      .from('payments')
      .select('sale_id, method, created_at')
      .in('sale_id', saleIds)
      .order('created_at', { ascending: true })

    paymentsBySaleId = (payments ?? []).reduce<Record<string, string>>((acc, p) => {
      if (!acc[p.sale_id]) acc[p.sale_id] = p.method
      return acc
    }, {})
  }

  const rows = (sales ?? []).map(s => ({
    id: s.id,
    created_at: s.created_at,
    total: Number(s.total),
    status: s.status,
    method: paymentsBySaleId[s.id] ?? '',
  }))

  return (
    <SalesHistoryView
      rows={rows}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
    />
  )
}
