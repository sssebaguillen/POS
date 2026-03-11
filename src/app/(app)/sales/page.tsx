import { createClient } from '@/lib/supabase/server'
import SalesHistoryPanel, { type SaleHistoryRow } from '@/components/sales/SalesHistoryPanel'

export default async function SalesPage() {
  const supabase = await createClient()

  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const { data: sales } = await supabase
    .from('sales')
    .select('id, total, status, created_at')
    .gte('created_at', startOfDay.toISOString())
    .lte('created_at', endOfDay.toISOString())
    .order('created_at', { ascending: false })

  const saleIds = (sales ?? []).map(sale => sale.id)

  let paymentsBySaleId: Record<string, string> = {}

  if (saleIds.length > 0) {
    const { data: payments } = await supabase
      .from('payments')
      .select('sale_id, method, created_at')
      .in('sale_id', saleIds)
      .order('created_at', { ascending: false })

    paymentsBySaleId = (payments ?? []).reduce<Record<string, string>>((acc, payment) => {
      if (!acc[payment.sale_id]) {
        acc[payment.sale_id] = payment.method
      }
      return acc
    }, {})
  }

  const rows: SaleHistoryRow[] = (sales ?? []).map(sale => ({
    id: sale.id,
    created_at: sale.created_at,
    total: Number(sale.total),
    status: sale.status,
    payment_method: paymentsBySaleId[sale.id] ?? null,
  }))

  return <SalesHistoryPanel sales={rows} />
}
