import { parsePermissions, type Permissions } from '@/lib/operator'

export interface SettingsBusiness {
  id: string
  name: string
  description: string | null
  whatsapp: string | null
  logo_url: string | null
  slug: string
  settings: { primary_color?: string } | null
}

export type OperatorRole = 'manager' | 'cashier' | 'custom'

export interface SettingsOperator {
  id: string
  name: string
  role: OperatorRole
  permissions: Permissions
}

export function isSettingsOperator(value: unknown): value is SettingsOperator {
  if (!value || typeof value !== 'object') {
    return false
  }

  const operator = value as Record<string, unknown>

  const permissions = parsePermissions(operator.permissions)

  return (
    typeof operator.id === 'string' &&
    typeof operator.name === 'string' &&
    (operator.role === 'manager' || operator.role === 'cashier' || operator.role === 'custom') &&
    permissions !== null
  )
}
