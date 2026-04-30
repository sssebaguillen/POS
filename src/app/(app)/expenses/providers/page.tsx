import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator } from '@/lib/operator'
import type { Supplier } from '@/components/expenses/types'
import ProvidersView from '@/components/expenses/ProvidersView'

export const metadata = { title: 'Proveedores' }

export default async function ProvidersPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const businessId = await requireAuthenticatedBusinessId(supabase)

  if (activeOperator && !activeOperator.permissions.expenses) {
    redirect('/expenses')
  }

  const { data } = await supabase
    .from('suppliers')
    .select('id, business_id, name, contact_name, phone, email, address, notes, is_active, created_at')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name')

  const suppliers = (data ?? []) as Supplier[]

  return <ProvidersView businessId={businessId} initialSuppliers={suppliers} />
}
