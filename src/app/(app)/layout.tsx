import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/shared/AppShell'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_id')
    .eq('id', user.id)
    .maybeSingle()

  let primaryColor = '#4f46e5'

  if (profile?.business_id) {
    const { data: business } = await supabase
      .from('businesses')
      .select('settings')
      .eq('id', profile.business_id)
      .maybeSingle()

    const color = business?.settings?.primary_color
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      primaryColor = color
    }
  }

  return (
    <>
      <style>{`:root { --primary: ${primaryColor}; --ring: ${primaryColor}; }`}</style>
      <AppShell activeOperatorName={activeOperator?.name ?? null}>
        {children}
      </AppShell>
    </>
  )
}
