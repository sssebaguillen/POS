export const runtime = 'edge'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator, hasPermission } from '@/lib/operator'
import ReplenishmentView from '@/components/inventory/ReplenishmentView'
import type { ReplenishmentRow, ReplenishmentSummary } from '@/lib/types'

// Set chico (solo productos en/por debajo del mínimo): se trae completo en una
// llamada y el filtro vive en el cliente. 500 es el tope de la RPC.
const MAX_ROWS = 500
const WINDOW_DAYS = 30

export default async function ReplenishmentPage() {
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  // Defense-in-depth: el proxy ya gatea /inventory/* por inventory_read.
  if (activeOperator && !hasPermission(activeOperator, 'inventory_read')) {
    redirect('/pos')
  }

  const { data: raw, error } = await supabase.rpc('get_replenishment_list', {
    p_business_id: businessId,
    p_window_days: WINDOW_DAYS,
    p_limit: MAX_ROWS,
    p_offset: 0,
  })
  if (error) throw new Error(`get_replenishment_list: ${error.message}`)

  const payload = raw as unknown as {
    data: ReplenishmentRow[]
    total: number
    summary: ReplenishmentSummary
  } | null

  return (
    <ReplenishmentView
      rows={payload?.data ?? []}
      summary={payload?.summary ?? null}
    />
  )
}
