export const runtime = 'edge'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator, hasPermission } from '@/lib/operator'
import { resolveDateRange } from '@/lib/date-utils'
import ActivityView from '@/components/activity/ActivityView'
import { ENTITY_FILTER_VALUES, OWNER_OPERATOR_FILTER_VALUE } from '@/components/activity/config'
import { parseActivityPeriod } from '@/components/activity/utils'
import type {
  ActivityFilterOperator,
  ActivityLogRow,
  ActivityEntityFilter,
} from '@/components/activity/types'

interface SearchParams {
  entity?: string
  operator?: string
  period?: string
  from?: string
  to?: string
  page?: string
}

const PAGE_SIZE = 50
const OWNER_SENTINEL = '00000000-0000-0000-0000-000000000000'

function parseEntity(value: string | undefined): ActivityEntityFilter {
  if (value && ENTITY_FILTER_VALUES.includes(value as ActivityEntityFilter)) {
    return value as ActivityEntityFilter
  }
  return 'all'
}

function parsePage(value: string | undefined): number {
  if (!value) return 1
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function toIsoStartOfDay(value: string | null): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function toIsoEndOfDayExclusive(value: string | null): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)
  if (activeOperator && !hasPermission(activeOperator, 'analysis')) {
    redirect('/pos')
  }

  const entity = parseEntity(params.entity)
  const page = parsePage(params.page)
  const operatorFilter = params.operator ?? null

  const period = parseActivityPeriod(params.period)
  const { from: dateFrom, to: dateTo } = resolveDateRange(period, params.from, params.to)

  const rpcOperatorId =
    operatorFilter === OWNER_OPERATOR_FILTER_VALUE
      ? OWNER_SENTINEL
      : operatorFilter && operatorFilter !== 'all'
        ? operatorFilter
        : null

  const [
    { data: operatorsRaw },
    { data: rpcResult },
    { data: categoriesRaw },
    { data: brandsRaw },
    { data: productsRaw },
    { data: customersRaw },
  ] = await Promise.all([
    supabase
      .from('operators')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name'),
    supabase.rpc('get_audit_log', {
      p_business_id: businessId,
      p_entity_type: entity === 'all' ? null : entity,
      p_operator_id: rpcOperatorId,
      p_date_from: toIsoStartOfDay(dateFrom),
      p_date_to: toIsoEndOfDayExclusive(dateTo),
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase
      .from('categories')
      .select('id, name, icon, icon_color')
      .eq('business_id', businessId),
    supabase
      .from('brands')
      .select('id, name')
      .eq('business_id', businessId),
    supabase
      .from('products')
      .select('id, name')
      .eq('business_id', businessId)
      .limit(5000),
    supabase
      .from('customers')
      .select('id, name')
      .eq('business_id', businessId)
      .limit(5000),
  ])

  const operators: ActivityFilterOperator[] = (operatorsRaw ?? []).map(o => ({
    id: o.id,
    name: o.name,
  }))

  const categoryMap: Record<string, { name: string; icon: string | null; icon_color: string | null }> = {}
  for (const c of categoriesRaw ?? []) {
    categoryMap[c.id] = { name: c.name, icon: c.icon ?? null, icon_color: c.icon_color ?? null }
  }

  const brandMap: Record<string, string> = {}
  for (const b of brandsRaw ?? []) brandMap[b.id] = b.name

  const productMap: Record<string, string> = {}
  for (const p of productsRaw ?? []) productMap[p.id] = p.name

  const customerMap: Record<string, string> = {}
  for (const c of customersRaw ?? []) customerMap[c.id] = c.name

  const payload = rpcResult as unknown as { data: ActivityLogRow[]; total: number } | null
  const rows = payload?.data ?? []
  const total = payload?.total ?? 0

  return (
    <ActivityView
      rows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      operators={operators}
      entity={entity}
      operatorFilter={operatorFilter}
      period={period}
      from={params.from}
      to={params.to}
      categoryMap={categoryMap}
      brandMap={brandMap}
      productMap={productMap}
      customerMap={customerMap}
    />
  )
}
