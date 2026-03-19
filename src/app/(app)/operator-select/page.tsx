export const runtime = 'edge'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OperatorSelectView from '@/components/operator/OperatorSelectView'

interface Profile {
  id: string
  name: string
  business_id: string
}

interface OperatorRow {
  id: string
  name: string
  role: 'manager' | 'cashier' | 'custom'
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, business_id')
    .eq('id', user.id)
    .single<Profile>()

  if (profileError || !profile?.business_id) {
    throw new Error(profileError?.message ?? 'No se pudo obtener el perfil del usuario autenticado.')
  }

  const { data: operators, error: operatorsError } = await supabase
    .from('operators')
    .select('id, name, role')
    .eq('business_id', profile.business_id)
    .eq('is_active', true)
    .order('name')

  if (operatorsError) {
    throw new Error(operatorsError.message)
  }

  const visibleOperators: OperatorRow[] = (operators ?? []).filter(isOperatorRow)

  return (
    <OperatorSelectView
      ownerProfile={profile}
      operators={visibleOperators}
      availableOperatorsCount={visibleOperators.length}
    />
  )
}
