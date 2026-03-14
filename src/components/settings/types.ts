export interface SettingsBusiness {
  id: string
  name: string
  description: string | null
  whatsapp: string | null
  logo_url: string | null
}

export type OperatorRole = 'manager' | 'cashier'

export interface SettingsOperator {
  id: string
  name: string
  role: OperatorRole
}

export function isSettingsOperator(value: unknown): value is SettingsOperator {
  if (!value || typeof value !== 'object') {
    return false
  }

  const operator = value as Record<string, unknown>

  return (
    typeof operator.id === 'string' &&
    typeof operator.name === 'string' &&
    (operator.role === 'manager' || operator.role === 'cashier')
  )
}