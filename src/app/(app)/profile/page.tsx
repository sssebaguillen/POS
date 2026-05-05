import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProfileView from '@/components/profile/ProfileView'
import PageHeader from '@/components/shared/PageHeader'
import { requireAuthenticatedBusinessId } from '@/lib/business'

export default async function ProfilePage() {
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile, error: profileError }, { data: business, error: businessError }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, avatar_url, business_id')
        .eq('id', user.id)
        .single(),
      supabase
        .from('businesses')
        .select('name, plan')
        .eq('id', businessId)
        .single(),
    ])

  if (profileError || !profile) redirect('/login')
  if (businessError || !business) throw new Error(businessError?.message ?? 'Failed to load business')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Perfil" breadcrumbs={[{ label: 'Configuración', href: '/settings' }]} />
      <ProfileView profile={profile} email={user.email ?? ''} business={business} />
    </div>
  )
}
