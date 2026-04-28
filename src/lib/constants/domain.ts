// Payment method keys must match the DB CHECK constraint exactly
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'mercadopago', 'credit'] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mercadopago: 'MercadoPago',
  credit: 'Crédito',
}

// Operator role keys must match the DB CHECK constraint exactly
export const OPERATOR_ROLES = ['cashier', 'manager', 'custom'] as const
export type OperatorRole = typeof OPERATOR_ROLES[number]

export const OPERATOR_ROLE_LABELS: Record<OperatorRole, string> = {
  cashier: 'Cajero',
  manager: 'Encargado',
  custom: 'Personalizado',
}

// Profile role (owner — lives in profiles table, not operators)
export const PROFILE_ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
}
