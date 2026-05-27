import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@/lib/constants/domain'
import { ACCENT_BAR, ACCENT_DOT, type AccentTone } from '@/lib/accent-colors'

export { PAYMENT_METHOD_LABELS as PAYMENT_LABELS } from '@/lib/constants/domain'

export const PAYMENT_TONE: Record<PaymentMethod, AccentTone> = {
  cash: 'emerald',
  card: 'violet',
  transfer: 'amber',
  mercadopago: 'sky',
  credit: 'rose',
}

export const PAYMENT_COLORS: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map(m => [m, ACCENT_DOT[PAYMENT_TONE[m]]])
) as Record<PaymentMethod, string>

export const PAYMENT_BAR_COLORS: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map(m => [m, ACCENT_BAR[PAYMENT_TONE[m]]])
) as Record<PaymentMethod, string>

export function isPaymentMethod(value: string | null): value is PaymentMethod {
  return value !== null && PAYMENT_METHODS.includes(value as PaymentMethod)
}

export function normalizePayment(method: string | null): string {
  if (!method) return 'sin dato'
  return isPaymentMethod(method) ? PAYMENT_METHOD_LABELS[method] : method
}

export const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = PAYMENT_METHODS.map(value => ({
  value,
  label: PAYMENT_METHOD_LABELS[value],
}))
