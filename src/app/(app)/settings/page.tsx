import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/shared/PageHeader'
import SettingsForm from '@/components/settings/SettingsForm'

interface SettingsBusiness {
  id: string
  name: string
  description: string | null
  whatsapp: string | null
  logo_url: string | null
}

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('business_id')
    .eq('id', user.id)
    .single()

  const businessId = profile?.business_id ?? null

  if (profileError || !businessId) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <PageHeader title="Configuración" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl bg-card border border-border/60 p-6">
            <p className="text-sm text-destructive">
              {profileError?.message ?? 'No se pudo obtener el negocio asociado al usuario actual.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, description, whatsapp, logo_url')
    .eq('id', businessId)
    .single<SettingsBusiness>()

  if (businessError || !business) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <PageHeader title="Configuración" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl bg-card border border-border/60 p-6">
            <p className="text-sm text-destructive">
              {businessError?.message ?? 'No se pudo cargar la configuración del negocio.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Configuración" />
      <div className="flex-1 overflow-y-auto p-6">
        <SettingsForm business={business} />
      </div>
    </div>
  )
}
