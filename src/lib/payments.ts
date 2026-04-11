import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@/lib/constants/domain'

export const PAYMENT_COLORS: Record<PaymentMethod, string> = {
  cash: 'bg-emerald-600',
  card: 'bg-indigo-500',
  transfer: 'bg-amber-500',
  mercadopago: 'bg-sky-500',
}

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
