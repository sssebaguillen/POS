import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/shared/PageHeader'
import OperatorMeView from '@/components/operator/OperatorMeView'
import { createClient } from '@/lib/supabase/server'
import { resolveDateRange, type DateRangePeriod } from '@/lib/date-utils'
import { getActiveOperator, type UserRole } from '@/lib/operator'
import type { OperatorRole } from '@/lib/constants/domain'
import { requireAuthenticatedBusinessId } from '@/lib/business'

interface SearchParams {
  period?: string
  from?: string
  to?: string
}

interface OperatorProfileRow {
  id: string
  name: string
  role: OperatorRole
  created_at: string
}

interface OwnerProfileRow {
  id: string
  name: string
  created_at: string
}

interface OperatorStatsTopProduct {
  product_name: string
  total_quantity: number | null
  total_revenue: number | null
}

interface OperatorStatsSaleHistoryRow {
  id: string
  total: number | null
  created_at: string
  status: string | null
  items_count: number | null
}

interface OperatorStatsResult {
  success: boolean
  total_sales: number | null
  total_revenue: number | null
  top_products: OperatorStatsTopProduct[] | null
  sale_history: OperatorStatsSaleHistoryRow[] | null
}

const VALID_PERIODS: DateRangePeriod[] = ['hoy', 'semana', 'mes', 'trimestre', 'año', 'personalizado']
const BUSINESS_TIMEZONE_OFFSET = '-03:00'

function getPeriod(value: string | undefined): DateRangePeriod {
  if (value && VALID_PERIODS.includes(value as DateRangePeriod)) {
    return value as DateRangePeriod
  }

  return 'mes'
}

function formatMemberSince(value: string): string {
  return new Date(value).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function toRangeTimestamps(from: string | null, to: string | null): { from: string | null; to: string | null } {
  return {
    from: from ? `${from}T00:00:00${BUSINESS_TIMEZONE_OFFSET}` : null,
    to: to ? `${to}T23:59:59.999${BUSINESS_TIMEZONE_OFFSET}` : null,
  }
}

export default async function OperatorMePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (!activeOperator) {
    redirect('/operator-select')
  }

  const businessId = await requireAuthenticatedBusinessId(supabase)
  const period = getPeriod(params.period)
  const { from, to } = resolveDateRange(period, params.from, params.to)
  const statsRange = toRangeTimestamps(from, to)

  let operatorName = activeOperator.name
  let operatorRole: UserRole = activeOperator.role
  let memberSince = ''
  let totalSales = 0
  let totalRevenue = 0
  let topProducts: {
    product_name: string
    total_quantity: number
    total_revenue: number
  }[] = []
  let saleHistory: {
    id: string
    total: number
    created_at: string
    status: string | null
    items_count: number
  }[] = []

  if (activeOperator.role === 'owner') {
    const { data: ownerProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, name, created_at')
      .eq('id', activeOperator.profile_id)
      .single<OwnerProfileRow>()

    if (profileError || !ownerProfile) {
      throw new Error(profileError?.message ?? 'No se pudo cargar el perfil del owner.')
    }

    const { data: statsRaw, error: statsError } = await supabase.rpc('get_owner_stats', {
      p_date_from: statsRange.from,
      p_date_to: statsRange.to,
    })

    if (statsError) throw new Error(statsError.message)

    const stats = statsRaw as unknown as OperatorStatsResult | null

    if (!stats || stats.success !== true) {
      throw new Error('No se pudieron cargar las estadísticas.')
    }

    operatorName = ownerProfile.name
    memberSince = formatMemberSince(ownerProfile.created_at)
    totalSales = Number(stats.total_sales ?? 0)
    totalRevenue = Number(stats.total_revenue ?? 0)
    topProducts = (stats.top_products ?? []).map(p => ({
      product_name: p.product_name,
      total_quantity: Number(p.total_quantity ?? 0),
      total_revenue: Number(p.total_revenue ?? 0),
    }))
    saleHistory = (stats.sale_history ?? []).map(s => ({
      id: s.id,
      total: Number(s.total ?? 0),
      created_at: s.created_at,
      status: s.status,
      items_count: Number(s.items_count ?? 0),
    }))
  } else {
    const [{ data: operator, error: operatorError }, { data: statsRaw, error: statsError }] =
      await Promise.all([
        supabase
          .from('operators')
          .select('id, name, role, created_at')
          .eq('business_id', businessId)
          .eq('id', activeOperator.profile_id)
          .single<OperatorProfileRow>(),
        supabase.rpc('get_operator_stats', {
          p_operator_id: activeOperator.profile_id,
          p_date_from: statsRange.from,
          p_date_to: statsRange.to,
        }),
      ])

    if (operatorError || !operator) {
      throw new Error(operatorError?.message ?? 'No se pudo cargar el perfil del operario.')
    }

    if (statsError) {
      throw new Error(statsError.message)
    }

    const stats = statsRaw as unknown as OperatorStatsResult | null

    if (!stats || stats.success !== true) {
      throw new Error('No se pudieron cargar las estadísticas del operario.')
    }

    operatorName = operator.name
    operatorRole = operator.role
    memberSince = formatMemberSince(operator.created_at)
    totalSales = Number(stats.total_sales ?? 0)
    totalRevenue = Number(stats.total_revenue ?? 0)
    topProducts = (stats.top_products ?? []).map(product => ({
      product_name: product.product_name,
      total_quantity: Number(product.total_quantity ?? 0),
      total_revenue: Number(product.total_revenue ?? 0),
    }))
    saleHistory = (stats.sale_history ?? []).map(sale => ({
      id: sale.id,
      total: Number(sale.total ?? 0),
      created_at: sale.created_at,
      status: sale.status,
      items_count: Number(sale.items_count ?? 0),
    }))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Mi perfil" />
      <OperatorMeView
        businessId={businessId}
        operatorId={activeOperator.profile_id}
        operatorName={operatorName}
        operatorRole={operatorRole}
        memberSinceLabel={memberSince}
        canChangePin={activeOperator.role !== 'owner'}
        period={period}
        from={params.from}
        to={params.to}
        totalSales={totalSales}
        totalRevenue={totalRevenue}
        topProducts={topProducts}
        saleHistory={saleHistory}
      />
    </div>
  )
}
