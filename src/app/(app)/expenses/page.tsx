import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import ExpensesView from '@/components/expenses/ExpensesView'
import type { Expense, Supplier, BusinessBalance } from '@/components/expenses/types'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { resolveDateRange, type DateRangePeriod } from '@/lib/date-utils'
import { getActiveOperator } from '@/lib/operator'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period: DateRangePeriod =
    params.period === 'hoy' || params.period === 'semana' || params.period === 'personalizado' ||
    params.period === 'trimestre' || params.period === 'año'
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
    <ExpensesView
      expenses={expenses}
      balance={balance}
      suppliers={suppliers}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
      canUpdateStock={activeOperator?.permissions.stock_write ?? true}
    />
  )
}
