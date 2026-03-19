import { createClient } from '@/lib/supabase/server'
import DashboardView from '@/components/analytics/DashboardView'
import type { BusinessBalance } from '@/components/expenses/types'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let profileBusinessId: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    profileBusinessId = profile?.business_id ?? null
  }

  const businessId = profileBusinessId

  const [{ data: sales }, { data: products }, balanceResult] = await Promise.all([
    supabase
      .from('sales')
      .select('id, total, created_at, status')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(3000),
    supabase
      .from('products')
      .select('id, name, category_id, stock, min_stock, is_active')
      .eq('business_id', businessId)
      .limit(5000),
    supabase.rpc('get_business_balance', {
      p_business_id: businessId,
      p_from: null,
      p_to: null,
    }),
  ])

  const balance = (balanceResult.data as unknown as BusinessBalance | null) ?? {
    income: 0, expenses: 0, profit: 0, margin: 0, by_category: {}, period_from: '', period_to: '',
  }

  const saleIds = (sales ?? []).map(sale => sale.id)

  let payments: Array<{ sale_id: string; method: string; amount: number; created_at: string }> = []
  let saleItems: Array<{ sale_id: string; product_id: string | null; quantity: number; total: number }> = []

  if (saleIds.length > 0) {
    const [{ data: paymentsData }, { data: saleItemsData }] = await Promise.all([
      supabase
        .from('payments')
        .select('sale_id, method, amount, created_at')
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
      created_at: payment.created_at,
    }))

    saleItems = (saleItemsData ?? []).map(item => ({
      sale_id: item.sale_id,
      product_id: item.product_id,
      quantity: Number(item.quantity),
      total: Number(item.total),
    }))
  }

  return (
    <DashboardView
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
        stock: Number(product.stock),
        min_stock: Number(product.min_stock),
        is_active: Boolean(product.is_active),
      }))}
      businessId={businessId}
      balance={balance}
    />
  )
}
