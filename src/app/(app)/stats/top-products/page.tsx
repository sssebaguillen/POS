import { createClient } from '@/lib/supabase/server'
import TopProductsDetailView from '@/components/stats/TopProductsDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  page?: string
}

export default async function TopProductsDetailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const period = params.period ?? 'mes'
  const from = params.from
  const to = params.to
  const page = Number(params.page ?? 1)
  const limit = 50
  const offset = (page - 1) * limit

  const { data: result } = await supabase.rpc('get_top_products_detail', {
    p_business_id: businessId,
    p_from: from ?? null,
    p_to: to ?? null,
    p_limit: limit,
    p_offset: offset,
  })

  const rows = (result as unknown as { data: TopProductRow[]; total: number } | null)

  return (
    <TopProductsDetailView
      rows={rows?.data ?? []}
      total={rows?.total ?? 0}
      businessId={businessId}
      period={period}
      from={from}
      to={to}
      page={page}
    />
  )
}

interface TopProductRow {
  id: string
  name: string
  sku: string | null
  category_name: string | null
  brand_name: string | null
  price: number
  cost: number
  units_sold: number
  revenue: number
  gross_profit: number
  transaction_count: number
}
