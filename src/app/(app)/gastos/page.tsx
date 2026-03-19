import { createClient } from '@/lib/supabase/server'
import GastosView from '@/components/expenses/GastosView'
import type { Expense, Supplier, BusinessBalance, ExpenseCategory } from '@/components/expenses/types'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  category?: string
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
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

  const period = params.period ?? 'mes'
  const from = params.from ?? null
  const to = params.to ?? null
  const category = params.category ?? null

  const [balanceResult, expensesResult, suppliersResult] = await Promise.all([
    supabase.rpc('get_business_balance', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
    }),
    supabase.rpc('get_expenses_list', {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
      p_category: category,
      p_limit: 50,
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
    period_from: from ?? '',
    period_to: to ?? '',
  }

  const expensesData = (expensesResult.data as unknown as { data: Expense[]; total: number } | null)
  const expenses = expensesData?.data ?? []
  const suppliers = (suppliersResult.data ?? []) as Supplier[]

  return (
    <GastosView
      expenses={expenses}
      balance={balance}
      suppliers={suppliers}
      businessId={businessId ?? ''}
      period={period}
      from={from ?? undefined}
      to={to ?? undefined}
      category={category as ExpenseCategory | undefined}
    />
  )
}
