export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mercadopago: 'MercadoPago',
  credit: 'Crédito',
}

export const PAYMENT_COLORS: Record<string, string> = {
  cash: 'bg-emerald-600',
  card: 'bg-indigo-500',
  transfer: 'bg-amber-500',
  mercadopago: 'bg-sky-500',
  credit: 'bg-purple-500',
}

export function normalizePayment(method: string | null): string {
  if (!method) return 'sin dato'
  return PAYMENT_LABELS[method] ?? method
}
