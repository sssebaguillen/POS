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

  const PAGE_SIZE = 50

  const [{ data, error }, { data: receivableRaw, error: receivableError }] = await Promise.all([
    // Primera página server-side (búsqueda/filtro/orden por defecto) — la lista
    // se pagina en CustomerView. Evita el tope silencioso de PostgREST de traer
    // toda la tabla sin .limit().
    supabase.rpc('get_customers_list', {
      p_business_id: businessId,
      p_search: null,
      p_credit_filter: 'all',
      p_sort: 'name',
      p_limit: PAGE_SIZE,
      p_offset: 0,
    }),
    supabase.rpc('get_accounts_receivable_summary', { p_business_id: businessId }),
  ])

  if (error) throw new Error(`customers: ${error.message}`)
  if (receivableError) throw new Error(`customers receivable: ${receivableError.message}`)

  const listResult = (data as unknown as { data: Customer[]; total: number } | null) ?? { data: [], total: 0 }
  const customers = listResult.data ?? []
  const initialTotal = Number(listResult.total) || 0

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
      initialTotal={initialTotal}
      accountsReceivable={accountsReceivable}
    />
  )
}
