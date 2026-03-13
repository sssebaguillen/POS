import { createClient } from '@/lib/supabase/server'
import StatsView from '@/components/analytics/StatsView'

export default async function StatsPage() {
  const supabase = await createClient()

  const { data: sales } = await supabase
    .from('sales')
    .select('id, total, created_at, status')
    .order('created_at', { ascending: false })
    .limit(3000)

  const saleIds = (sales ?? []).map(sale => sale.id)

  let payments: Array<{ sale_id: string; method: string; amount: number }> = []
  let saleItems: Array<{ sale_id: string; product_id: string | null; quantity: number; total: number }> = []

  if (saleIds.length > 0) {
    const [{ data: paymentsData }, { data: saleItemsData }] = await Promise.all([
      supabase
        .from('payments')
        .select('sale_id, method, amount')
        .in('sale_id', saleIds)
        .limit(5000),
      supabase
        .from('sale_items')
        .select('sale_id, product_id, quantity, total')
        .in('sale_id', saleIds)
        .limit(10000),
    ])

    payments = (paymentsData ?? []).map(payment => ({
      sale_id: payment.sale_id,
      method: payment.method,
      amount: Number(payment.amount),
    }))

    saleItems = (saleItemsData ?? []).map(item => ({
      sale_id: item.sale_id,
      product_id: item.product_id,
      quantity: Number(item.quantity),
      total: Number(item.total),
    }))
  }

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category_id, sku')
      .limit(5000),
    supabase
      .from('categories')
      .select('id, name')
      .limit(500),
  ])

  return (
    <StatsView
      sales={(sales ?? []).map(sale => ({
        id: sale.id,
        total: Number(sale.total),
        created_at: sale.created_at,
        status: sale.status,
      }))}
      payments={payments}
      saleItems={saleItems}
      products={(products ?? []).map(product => ({
        id: product.id,
        name: product.name,
        category_id: product.category_id,
        sku: product.sku,
      }))}
      categories={(categories ?? []).map(category => ({
        id: category.id,
        name: category.name,
      }))}
    />
  )
}
