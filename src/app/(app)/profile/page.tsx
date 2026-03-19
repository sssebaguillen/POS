import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProfileView from '@/components/profile/ProfileView'
import PageHeader from '@/components/shared/PageHeader'

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, avatar_url, business_id')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) redirect('/login')

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('name, plan')
    .eq('id', profile.business_id)
    .single()

  if (businessError || !business) {
    throw new Error(businessError?.message ?? 'Failed to load business')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Perfil" breadcrumbs={[{ label: 'Configuración', href: '/settings' }]} />
      <ProfileView
        profile={profile}
        email={user.email ?? ''}
        business={business}
      />
    </div>
  )
}
