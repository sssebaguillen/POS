export const runtime = 'edge'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OperatorSelectView from '@/components/operator/OperatorSelectView'
import AppShell from '@/components/shared/AppShell'
import QueryProvider from '@/providers/query-provider'
import { OPERATOR_ROLES } from '@/lib/constants/domain'
import type { UserRole } from '@/lib/types'

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
    OPERATOR_ROLES.includes(operator.role as Exclude<UserRole, 'owner'>)
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
    .select('id, name, business_id')
    .eq('id', user.id)
    .single<{ id: string; name: string; business_id: string | null }>()

  if (profileError || !ownerProfile) {
    throw new Error(profileError?.message ?? 'No se pudo obtener el perfil del usuario autenticado.')
  }

  if (!ownerProfile.business_id) {
    throw new Error('No se pudo obtener el negocio asociado al usuario autenticado.')
  }

  const [{ data: business }, { data: operators, error: operatorsError }] = await Promise.all([
    supabase
      .from('businesses')
      .select('name')
      .eq('id', ownerProfile.business_id)
      .maybeSingle<{ name: string | null }>(),
    supabase
      .from('operators')
      .select('id, name, role')
      .eq('business_id', ownerProfile.business_id)
      .eq('is_active', true)
      .order('name'),
  ])

  if (operatorsError) {
    throw new Error(operatorsError.message)
  }

  const businessName = business?.name?.trim() || 'Mi negocio'
  const visibleOperators: OperatorRow[] = (operators ?? []).filter(isOperatorRow)

  return (
    <QueryProvider>
      <AppShell
        minimal
        activeOperatorName={null}
        activeOperatorRole={null}
        permissions={null}
        businessId={ownerProfile.business_id}
        businessName={businessName}
        businessSlug=""
      >
        <OperatorSelectView
          ownerProfile={{ id: ownerProfile.id, name: ownerProfile.name }}
          operators={visibleOperators}
          availableOperatorsCount={visibleOperators.length}
        />
      </AppShell>
    </QueryProvider>
  )
}
