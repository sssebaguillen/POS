import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator } from '@/lib/operator'
import { redirect } from 'next/navigation'
import CashSessionsView from '@/components/cash-sessions/CashSessionsView'

export const dynamic = 'force-dynamic'

export default async function CashSessionsPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  const businessId = await requireAuthenticatedBusinessId(supabase)

  // Only owner and operators with reports permission can access /cash-sessions
  if (activeOperator && activeOperator.role !== 'owner' && !activeOperator.permissions.reports) {
    redirect('/pos')
  }

  const [activeSessionResult, sessionsResult] = await Promise.all([
    supabase.rpc('get_active_session'),
    supabase.rpc('get_sessions_list', { p_limit: 20, p_offset: 0 }),
  ])

  const activeSession = activeSessionResult.data as ActiveSessionRow | null
  const sessionsData = (sessionsResult.data as { success: boolean; data: SessionRow[]; total: number } | null)
  const sessions = sessionsData?.data ?? []
  const total = sessionsData?.total ?? 0

  const operatorId = activeOperator?.role === 'owner' || !activeOperator ? null : activeOperator.profile_id

  return (
    <CashSessionsView
      businessId={businessId}
      activeSession={activeSession}
      initialSessions={sessions}
      initialTotal={total}
      operatorId={operatorId}
    />
  )
}

export interface ActiveSessionRow {
  id: string
  opening_amount: number
  opened_at: string
  opened_by: string | null
  opened_by_name: string
  status: 'open'
  sales_count: number
  sales_total: number
}

export interface SessionRow {
  id: string
  status: 'open' | 'closed'
  opening_amount: number
  closing_amount: number | null
  expected_amount: number | null
  difference: number | null
  opened_at: string
  closed_at: string | null
  duration_seconds: number
  notes: string | null
  opened_by_name: string
  closed_by_name: string | null
  sales_count: number
  sales_total: number
}
