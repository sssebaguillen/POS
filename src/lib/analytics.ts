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

export function trackFeatureUsed(feature: string) {
  if (!isEnabled()) return
  posthog.capture('feature_used', { feature })
}

export function resetTracking() {
  if (!isEnabled()) return
  posthog.reset()
}
