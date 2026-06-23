import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator } from '@/lib/operator'
import CustomerView from '@/components/customers/CustomerView'
import type { Customer } from '@/lib/types'

export default async function CustomersPage() {
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)
  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)

  const [{ data, error }, { data: receivableRaw, error: receivableError }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, business_id, name, phone, email, dni, credit_balance, credit_limit, is_credit_enabled, notes, created_at')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase.rpc('get_accounts_receivable_summary', { p_business_id: businessId }),
  ])

  if (error) throw new Error(`customers: ${error.message}`)
  if (receivableError) throw new Error(`customers receivable: ${receivableError.message}`)

  const customers = (data ?? []) as Customer[]

  // Total exacto de cuentas por cobrar, agregado server-side (misma RPC que el
  // dashboard) — evita el tope silencioso de PostgREST de sumar la lista en memoria.
  const receivableRow = (receivableRaw as unknown as {
    total_receivable: number
    debtors_count: number
  } | null) ?? { total_receivable: 0, debtors_count: 0 }
  const accountsReceivable = {
    total: Number(receivableRow.total_receivable) || 0,
    debtors: Number(receivableRow.debtors_count) || 0,
  }

  return (
    <CustomerView
      businessId={businessId}
      operatorId={activeOperator?.profile_id ?? null}
      initialCustomers={customers}
      accountsReceivable={accountsReceivable}
    />
  )
}
