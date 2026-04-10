import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { getActiveOperator } from '@/lib/operator'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import type { UserRole } from '@/lib/operator'

interface OperatorProfileRow {
  id: string
  name: string
  role: 'manager' | 'cashier' | 'custom'
}

interface OwnerProfileRow {
  id: string
  name: string
}

function roleLabel(role: UserRole): string {
  if (role === 'owner') return 'Owner'
  if (role === 'manager') return 'Manager'
  if (role === 'custom') return 'Custom'
  return 'Cashier'
}

export default async function OperatorMePage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (!activeOperator) {
    redirect('/operator-select')
  }

  const businessId = await requireAuthenticatedBusinessId(supabase)
  let profileName = activeOperator.name
  let profileRole: UserRole = activeOperator.role

  if (activeOperator.role === 'owner') {
    const { data: ownerProfile, error } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('id', activeOperator.profile_id)
      .single<OwnerProfileRow>()

    if (error || !ownerProfile) {
      throw new Error(error?.message ?? 'No se pudo cargar el perfil del owner.')
    }

    profileName = ownerProfile.name
  } else {
    const { data: operator, error } = await supabase
      .from('operators')
      .select('id, name, role')
      .eq('business_id', businessId)
      .eq('id', activeOperator.profile_id)
      .single<OperatorProfileRow>()

    if (error || !operator) {
      throw new Error(error?.message ?? 'No se pudo cargar el perfil del operario.')
    }

    profileName = operator.name
    profileRole = operator.role
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Mi perfil" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-xl">
          <div className="surface-card space-y-6 p-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Operario activo</p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground">{profileName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{roleLabel(profileRole)}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Nombre</p>
                <p className="mt-2 text-sm font-medium text-foreground">{profileName}</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Rol</p>
                <p className="mt-2 text-sm font-medium text-foreground">{roleLabel(profileRole)}</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              La edición de datos sensibles del operario se realiza desde el selector o la configuración del negocio.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
