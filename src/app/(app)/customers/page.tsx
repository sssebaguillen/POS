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

  const { data } = await supabase
    .from('customers')
    .select('id, business_id, name, phone, email, dni, credit_balance, credit_limit, is_credit_enabled, notes, created_at')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  const customers = (data ?? []) as Customer[]

  return (
    <CustomerView
      businessId={businessId}
      operatorId={activeOperator?.profile_id ?? null}
      initialCustomers={customers}
    />
  )
}
