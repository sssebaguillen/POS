export const runtime = 'edge'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import DashboardView from '@/components/dashboard/DashboardView'
import type { BusinessBalance } from '@/components/expenses/types'
import { requireAuthenticatedBusinessContext } from '@/lib/business'
import { getActiveOperator } from '@/lib/operator'
import { normalizePriceList } from '@/lib/mappers'
import { resolveDateRange } from '@/lib/date-utils'
import type { PriceList, StatsKpis, SalesHeatmapCell } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import { CURRENCIES, type SupportedCurrencyCode } from '@/lib/constants/currencies'
import { parseOnboardingState } from '@/components/onboarding/onboarding-types'
import type { RecentActivityRow } from '@/components/dashboard/DashboardView'

export default async function DashboardPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = await getActiveOperator(cookieStore)

  const { userId, businessId } = await requireAuthenticatedBusinessContext(supabase)

  // Seed del período inicial ("hoy") para el primer paint del Resumen sin parpadeo.
  // Los demás períodos los refetchea DashboardView client-side por React Query.
  const hoy = resolveDateRange('hoy')

  const [
    { data: kpisRaw },
    { data: balanceRaw },
    { data: heatmapRaw },
    { data: products },
    { data: business },
    { data: profile },
    { data: recentActivityRaw },
    { data: operatorsData },
  ] = await Promise.all([
    supabase.rpc('get_stats_kpis', { p_business_id: businessId, p_from: hoy.from, p_to: hoy.to }),
    supabase.rpc('get_business_balance', { p_business_id: businessId, p_from: hoy.from, p_to: hoy.to }),
    supabase.rpc('get_sales_heatmap', { p_business_id: businessId, p_from: hoy.from, p_to: hoy.to }),
    supabase
      .from('products')
      .select('id, name, category_id, stock, min_stock, is_active')
      .eq('business_id', businessId)
      .limit(5000),
    supabase
      .from('businesses')
      .select('name, settings')
      .eq('id', businessId)
      .single(),
    supabase.from('profiles').select('id, role, onboarding_state').eq('id', userId).single(),
    supabase.rpc('get_audit_log', {
      p_business_id: businessId,
      p_entity_type: null,
      p_operator_id: null,
      p_date_from: null,
      p_date_to: null,
      p_limit: 6,
      p_offset: 0,
    }),
    supabase
      .from('operators')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name'),
  ])

  const recentActivity =
    ((recentActivityRaw as unknown as { data: RecentActivityRow[] } | null)?.data ?? []) as RecentActivityRow[]

  const initialKpis = (kpisRaw as unknown as StatsKpis | null)
  const initialBalance = (balanceRaw as unknown as BusinessBalance | null)
  const initialHeatmap = (heatmapRaw as unknown as { data: SalesHeatmapCell[] } | null)?.data ?? []

  const onboarding = parseOnboardingState(profile?.onboarding_state)
  const isOwnerProfile = profile?.role === 'owner'
  const showOnboardingWizard =
    isOwnerProfile &&
    !onboarding.completed &&
    !onboarding.tour_done &&
    !onboarding.wizard_suppressed &&
    onboarding.wizard_step < 5

  const needOnboardingExtras = isOwnerProfile && !onboarding.completed && !onboarding.tour_done

  let wizardCategories: { id: string; name: string; icon: string }[] = []
  let wizardBrands: InventoryBrand[] = []
  let wizardPriceLists: PriceList[] = []

  if (needOnboardingExtras) {
    const [{ data: categories }, { data: brands }, { data: priceListsData }] = await Promise.all([
      supabase
        .from('categories')
        .select('id, name, icon')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('position'),
      supabase.from('brands').select('id, name').eq('business_id', businessId).order('name'),
      supabase
        .from('price_lists')
        .select('id, business_id, name, description, multiplier, created_at')
        .eq('business_id', businessId)
        .order('created_at'),
    ])
    wizardCategories = (categories ?? []).map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon ?? '📦',
    }))
    wizardBrands = brands ?? []
    wizardPriceLists = (priceListsData ?? []).map(normalizePriceList)
  }

  const settingsRecord = (business?.settings ?? null) as Record<string, unknown> | null
  const rawCurrency = settingsRecord && typeof settingsRecord.currency === 'string' ? settingsRecord.currency : null
  const initialCurrency: SupportedCurrencyCode =
    rawCurrency && CURRENCIES.some(c => c.code === rawCurrency) ? (rawCurrency as SupportedCurrencyCode) : 'ARS'

  const operators = (operatorsData ?? []).map(op => ({ id: op.id, name: op.name }))

  return (
    <DashboardView
      operators={operators}
      products={(products ?? []).map(product => ({
        id: product.id,
        name: product.name,
        category_id: product.category_id,
        stock: Number(product.stock),
        min_stock: Number(product.min_stock),
        is_active: Boolean(product.is_active),
      }))}
      businessId={businessId}
      businessName={business?.name ?? ''}
      initialKpis={initialKpis}
      initialBalance={initialBalance}
      initialHeatmap={initialHeatmap}
      onboardingProfile={
        profile && typeof profile.id === 'string' && typeof profile.role === 'string'
          ? {
              id: profile.id,
              role: profile.role,
              onboarding_state: profile.onboarding_state,
            }
          : null
      }
      showOnboardingWizard={showOnboardingWizard}
      initialBusinessSettings={settingsRecord}
      initialCurrency={initialCurrency}
      operatorId={activeOperator?.profile_id ?? null}
      stockWriteAllowed={activeOperator === null || activeOperator.permissions.stock_write === true}
      wizardCategories={wizardCategories}
      wizardBrands={wizardBrands}
      wizardPriceLists={wizardPriceLists}
      recentActivity={recentActivity}
    />
  )
}
