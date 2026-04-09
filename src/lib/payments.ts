export const PAYMENT_LABELS: Record<'cash' | 'card' | 'transfer' | 'mercadopago' | 'credit', string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mercadopago: 'MercadoPago',
  credit: 'Crédito',
}

export const PAYMENT_COLORS: Record<'cash' | 'card' | 'transfer' | 'mercadopago' | 'credit', string> = {
  cash: 'bg-emerald-600',
  card: 'bg-indigo-500',
  transfer: 'bg-amber-500',
  mercadopago: 'bg-sky-500',
  credit: 'bg-purple-500',
}

export function normalizePayment(method: string | null): string {
  if (!method) return 'sin dato'
  const key = method as keyof typeof PAYMENT_LABELS
  return PAYMENT_LABELS[key] ?? method
}

export const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: PAYMENT_LABELS.cash },
  { value: 'card', label: PAYMENT_LABELS.card },
  { value: 'mercadopago', label: PAYMENT_LABELS.mercadopago },
  { value: 'transfer', label: PAYMENT_LABELS.transfer },
]
