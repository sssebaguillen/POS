import { redirect } from 'next/navigation'
import POSPage from './(app)/page'
import AppShell from '@/components/shared/AppShell'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'

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

  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  // If logged in, render the POS (sale) screen
  return (
    <AppShell activeOperatorName={activeOperator?.name ?? null}>
      <POSPage />
    </AppShell>
  )
}
