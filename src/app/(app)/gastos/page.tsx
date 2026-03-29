import { createClient } from '@/lib/supabase/server'
import GastosView from '@/components/expenses/GastosView'
import type { Expense, Supplier, BusinessBalance } from '@/components/expenses/types'
import { requireAuthenticatedBusinessId } from '@/lib/business'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

type FilterPeriod = 'hoy' | 'semana' | 'mes' | 'personalizado'

function resolveDateRange(
  period: FilterPeriod,
  from?: string,
  to?: string
): { from: string | null; to: string | null } {
  if (period === 'personalizado') {
    return {
      from: from ?? null,
      to: to ?? null,
    }
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const today = `${year}-${month}-${day}`

  if (period === 'hoy') {
    return { from: today, to: today }
  }

  if (period === 'semana') {
    const start = new Date(now)
    const weekday = start.getDay()
    const diff = weekday === 0 ? -6 : 1 - weekday
    start.setDate(start.getDate() + diff)

    const startYear = start.getFullYear()
    const startMonth = String(start.getMonth() + 1).padStart(2, '0')
    const startDay = String(start.getDate()).padStart(2, '0')

    return {
      from: `${startYear}-${startMonth}-${startDay}`,
      to: today,
    }
  }

  return {
    from: `${year}-${month}-01`,
    to: today,
  }
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period: FilterPeriod =
    params.period === 'hoy' || params.period === 'semana' || params.period === 'personalizado'
      ? params.period
      : 'mes'
  const from = params.from ?? undefined
  const to = params.to ?? undefined
  const resolvedRange = resolveDateRange(period, from, to)

  const [balanceResult, expensesResult, suppliersResult] = await Promise.all([
    supabase.rpc('get_business_balance', {
      p_business_id: businessId,
      p_from: resolvedRange.from,
      p_to: resolvedRange.to,
    }),
    supabase.rpc('get_expenses_list', {
      p_business_id: businessId,
      p_from: resolvedRange.from,
      p_to: resolvedRange.to,
      p_limit: 5000,
      p_offset: 0,
    }),
    supabase
      .from('suppliers')
      .select('id, business_id, name, contact_name, phone, email, address, notes, is_active, created_at')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name'),
  ])

  const balance = (balanceResult.data as unknown as BusinessBalance | null) ?? {
    income: 0,
    expenses: 0,
    profit: 0,
    margin: 0,
    by_category: {},
    period_from: resolvedRange.from ?? '',
    period_to: resolvedRange.to ?? '',
  }

  const expensesData = (expensesResult.data as unknown as { data: Expense[]; total: number } | null)
  const expenses = expensesData?.data ?? []
  const suppliers = (suppliersResult.data ?? []) as Supplier[]

  return (
    <GastosView
      expenses={expenses}
      balance={balance}
      suppliers={suppliers}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
    />
  )
}
