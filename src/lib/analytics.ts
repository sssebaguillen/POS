import posthog from 'posthog-js'

const isEnabled = () =>
  typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN

export function identifyUser(userId: string, businessId: string) {
  if (!isEnabled()) return
  posthog.identify(userId, { business_id: businessId })
}

export function trackSale(props: {
  total: number
  itemCount: number
  paymentMethods: string[]
  isMultiPayment: boolean
}) {
  if (!isEnabled()) return
  posthog.capture('sale_completed', {
    total: props.total,
    item_count: props.itemCount,
    payment_methods: props.paymentMethods,
    is_multi_payment: props.isMultiPayment,
  })
}

export function trackOperatorSwitch() {
  if (!isEnabled()) return
  posthog.capture('operator_session_started')
}

export function trackExpenseCreated(props: {
  tipo: string
  update_stock: boolean
  update_cost: boolean
  line_count: number
}) {
  if (!isEnabled()) return
  posthog.capture('expense_created', {
    tipo: props.tipo,
    update_stock: props.update_stock,
    update_cost: props.update_cost,
    line_count: props.line_count,
  })
}

export function trackOnboardingStepCompleted(step: string) {
  if (!isEnabled()) return
  posthog.capture('onboarding_step_completed', { step })
}

export function trackOnboardingCompleted() {
  if (!isEnabled()) return
  posthog.capture('onboarding_completed')
}

export function trackPriceListSwitched() {
  if (!isEnabled()) return
  posthog.capture('price_list_switched')
}

export function trackProductCreated(props: { has_variants: boolean }) {
  if (!isEnabled()) return
  posthog.capture('product_created', { has_variants: props.has_variants })
}

// trackFeatureUsed is actively used for: 'price_lists', 'expenses', 'barcode_scan',
// 'bulk_action', 'import_products'. Keep for ad-hoc feature engagement signals.
export function trackFeatureUsed(feature: string) {
  if (!isEnabled()) return
  posthog.capture('feature_used', { feature })
}

export function resetTracking() {
  if (!isEnabled()) return
  posthog.reset()
}
