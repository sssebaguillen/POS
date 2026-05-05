export const runtime = 'edge'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import DashboardView from '@/components/dashboard/DashboardView'
import type { BusinessBalance } from '@/components/expenses/types'
import type { PaymentMethod } from '@/lib/constants/domain'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { getActiveOperator } from '@/lib/operator'
import { normalizePriceList } from '@/lib/mappers'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import { CURRENCIES, type SupportedCurrencyCode } from '@/lib/constants/currencies'
import { parseOnboardingState } from '@/components/onboarding/onboarding-types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const businessId = await requireAuthenticatedBusinessId(supabase)

  const [{ data: sales }, { data: products }, { data: business }, balanceResult, { data: profile }] = await Promise.all([
    supabase
      .from('sales')
      .select('id, subtotal, discount, total, created_at, status, operator_id, operators(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(3000),
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
    supabase.rpc('get_business_balance', {
      p_business_id: businessId,
      p_from: null,
      p_to: null,
    }),
    supabase.from('profiles').select('id, role, onboarding_state').eq('id', user.id).single(),
  ])

  const balance = (balanceResult.data as unknown as BusinessBalance | null) ?? {
    income: 0, expenses: 0, profit: 0, margin: 0, by_category: {}, period_from: '', period_to: '',
  }

  const saleIds = (sales ?? []).map(sale => sale.id)

  let payments: Array<{ sale_id: string; method: PaymentMethod; amount: number; created_at: string }> = []
  let saleItems: Array<{ sale_id: string; product_id: string | null; quantity: number; total: number }> = []

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
        .select('id, business_id, name, description, multiplier, is_default, created_at')
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
      method: payment.method as PaymentMethod,
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
      sales={(sales ?? []).map(sale => {
        const operatorName = sale.operators && typeof sale.operators === 'object' && 'name' in sale.operators 
          ? (sale.operators.name as string)
          : null
        return {
          id: sale.id,
          subtotal: Number(sale.subtotal),
          discount: Number(sale.discount ?? 0),
          total: Number(sale.total),
          created_at: sale.created_at,
          status: sale.status,
          operator_name: operatorName,
        }
      })}
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
      businessName={business?.name ?? ''}
      balance={balance}
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
    />
  )
}
