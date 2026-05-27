import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator } from '@/lib/operator'
import OrdersView from '@/components/orders/OrdersView'
import type { CatalogOrderRow } from '@/components/orders/types'

export default async function OrdersPage() {
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)
  const cookieStore = await cookies()
  const operator = getActiveOperator(cookieStore)

  const since = new Date()
  since.setDate(since.getDate() - 30)

  const { data, error } = await supabase.rpc('get_catalog_orders', {
    p_status: null,
    p_from: since.toISOString(),
    p_to: null,
  })

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data as unknown as CatalogOrderRow[] | null) ?? []
  const orders = rows.map(row => ({
    ...row,
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    item_count: Number(row.item_count),
  }))

  return (
    <OrdersView
      initialOrders={orders}
      businessId={businessId}
      operatorId={operator?.profile_id ?? null}
    />
  )
}
