import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/shared/PageHeader'
import SettingsForm from '@/components/settings/SettingsForm'
import { isSettingsOperator, type SettingsBusiness, type SettingsOperator } from '@/components/settings/types'
import { requireAuthenticatedBusinessId } from '@/lib/business'

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const businessId = await requireAuthenticatedBusinessId(supabase)

  const [
    { data: business, error: businessError },
    { data: operators, error: operatorsError },
  ] = await Promise.all([
    supabase
      .from('businesses')
      .select('id, name, description, whatsapp, logo_url, slug, settings')
      .eq('id', businessId)
      .single<SettingsBusiness>(),
    supabase
      .from('operators')
      .select('id, name, role')
      .eq('business_id', businessId)
      .order('name'),
  ])

  if (businessError || !business) {
    throw new Error(businessError?.message ?? 'No se pudo cargar la configuracion del negocio.')
  }

  if (operatorsError) {
    throw new Error(operatorsError.message)
  }

  const parsedOperators: SettingsOperator[] = (operators ?? []).filter(isSettingsOperator)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Configuración" />
      <div className="flex-1 overflow-y-auto p-6">
        <SettingsForm business={business} operators={parsedOperators} />
      </div>
    </div>
  )
}
