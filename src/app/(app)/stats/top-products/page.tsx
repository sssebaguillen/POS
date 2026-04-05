import { createClient } from '@/lib/supabase/server'
import TopProductsDetailView from '@/components/stats/TopProductsDetailView'
import { requireAuthenticatedBusinessId } from '@/lib/business'

interface SearchParams {
  period?: string
  from?: string
  to?: string
  page?: string
}

/**
 * Translates a period label into a concrete { from, to } date range (YYYY-MM-DD, UTC).
 *
 * Rules:
 * - If explicit from+to are already present in the URL, they always win — this covers
 *   trimestre, año, and personalizado which set their own dates via the client navigate().
 * - Simple periods (hoy, semana, mes) have no dates in the URL so we compute them here,
 *   mirroring what DashboardView / StatsView do client-side via their `range` useMemo.
 * - Any other period without dates (degenerate state) returns null/null → no RPC filter.
 *
 * All arithmetic uses UTC getters/setters to avoid local-timezone day boundary shifts.
 */
function resolveDateRange(
  period: string,
  from?: string,
  to?: string
): { from: string | null; to: string | null } {
  // Explicit dates in the URL always take precedence (trimestre, año, personalizado)
  if (from && to) return { from, to }

  const now = new Date()
  const todayUTC = now.toISOString().slice(0, 10) // YYYY-MM-DD

  if (period === 'hoy') {
    return { from: todayUTC, to: todayUTC }
  }

  if (period === 'semana') {
    // ISO week: Monday is day 1. getUTCDay() returns 0=Sun … 6=Sat.
    const dayOfWeek = now.getUTCDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const monday = new Date(now)
    monday.setUTCDate(now.getUTCDate() - daysToMonday)
    return { from: monday.toISOString().slice(0, 10), to: todayUTC }
  }

  if (period === 'mes') {
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    return { from: `${year}-${month}-01`, to: todayUTC }
  }

  // trimestre / año / personalizado without explicit dates: preserve any single bound, let RPC filter one-sided
  return { from: from ?? null, to: to ?? null }
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
  const page = Number(params.page ?? 1)
  const limit = 50
  const offset = (page - 1) * limit

  const { from, to } = resolveDateRange(period, params.from, params.to)

  const { data: result } = await supabase.rpc('get_top_products_detail', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
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
      from={from ?? undefined}
      to={to ?? undefined}
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
