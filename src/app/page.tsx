import { redirect } from 'next/navigation'
import POSPage from './(app)/page'
import AppShell from '@/components/shared/AppShell'

export default async function Home() {
  // Dynamically import the POSPage logic
  // But first, check if user is logged in (server-side)
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // If logged in, render the POS (sale) screen
  return (
    <AppShell>
      <POSPage />
    </AppShell>
  )
}
