import { createClient } from '@/lib/supabase/server'
import SalesHistoryPanel, {
  type SaleHistoryRow,
  type SaleItemDetail,
} from '@/components/sales/SalesHistoryPanel'

function getProductNameFromRelation(relation: unknown) {
  if (Array.isArray(relation)) {
    const first = relation[0]
    if (first && typeof first === 'object' && 'name' in first && typeof first.name === 'string') {
      return first.name
    }
    return 'Producto eliminado'
  }

  if (relation && typeof relation === 'object' && 'name' in relation && typeof relation.name === 'string') {
    return relation.name
  }

  return 'Producto eliminado'
}

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
  let itemsBySaleId: Record<string, SaleItemDetail[]> = {}

  if (saleIds.length > 0) {
    const [{ data: payments }, { data: saleItems }] = await Promise.all([
      supabase
        .from('payments')
        .select('sale_id, method, created_at')
        .in('sale_id', saleIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('sale_items')
        .select('sale_id, quantity, unit_price, total, products(name)')
        .in('sale_id', saleIds),
    ])

    paymentsBySaleId = (payments ?? []).reduce<Record<string, string>>((acc, payment) => {
      if (!acc[payment.sale_id]) {
        acc[payment.sale_id] = payment.method
      }
      return acc
    }, {})

    itemsBySaleId = (saleItems ?? []).reduce<Record<string, SaleItemDetail[]>>((acc, item) => {
      const productName = getProductNameFromRelation(item.products)

      if (!acc[item.sale_id]) {
        acc[item.sale_id] = []
      }

      acc[item.sale_id].push({
        product_name: productName,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        total: Number(item.total),
      })

      return acc
    }, {})
  }

  const rows: SaleHistoryRow[] = (sales ?? []).map(sale => ({
    id: sale.id,
    created_at: sale.created_at,
    total: Number(sale.total),
    status: sale.status,
    payment_method: paymentsBySaleId[sale.id] ?? null,
    items: itemsBySaleId[sale.id] ?? [],
  }))

  return <SalesHistoryPanel sales={rows} />
}
