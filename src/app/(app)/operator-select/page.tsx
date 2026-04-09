export const runtime = 'edge'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OperatorSelectView from '@/components/operator/OperatorSelectView'
import { getBusinessIdByUserId } from '@/lib/business'
import type { UserRole } from '@/lib/operator'

interface Profile {
  id: string
  name: string
  business_id: string
}

interface OperatorRow {
  id: string
  name: string
  role: Exclude<UserRole, 'owner'>
}

function isOperatorRow(value: unknown): value is OperatorRow {
  if (!value || typeof value !== 'object') {
    return false
  }

  const operator = value as Record<string, unknown>
  return (
    typeof operator.id === 'string' &&
    typeof operator.name === 'string' &&
    (operator.role === 'manager' || operator.role === 'cashier' || operator.role === 'custom')
  )
}

export default async function OperatorSelectPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  const { data: ownerProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('id', user.id)
    .single<Pick<Profile, 'id' | 'name'>>()

  if (profileError || !ownerProfile) {
    throw new Error(profileError?.message ?? 'No se pudo obtener el perfil del usuario autenticado.')
  }

  const businessId = await getBusinessIdByUserId(supabase, user.id)

  if (!businessId) {
    throw new Error('No se pudo obtener el negocio asociado al usuario autenticado.')
  }

  const { data: operators, error: operatorsError } = await supabase
    .from('operators')
    .select('id, name, role')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('name')

  if (operatorsError) {
    throw new Error(operatorsError.message)
  }

  const visibleOperators: OperatorRow[] = (operators ?? []).filter(isOperatorRow)

  return (
    <OperatorSelectView
      ownerProfile={ownerProfile}
      operators={visibleOperators}
      availableOperatorsCount={visibleOperators.length}
    />
  )
}
