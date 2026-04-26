import { parsePermissions, type Permissions } from '@/lib/operator'
import { OPERATOR_ROLES, type OperatorRole } from '@/lib/constants/domain'

export interface SettingsBusiness {
  id: string
  name: string
  description: string | null
  whatsapp: string | null
  logo_url: string | null
  slug: string
  settings: { primary_color?: string; currency?: string } | null
}

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
    OPERATOR_ROLES.includes(operator.role as OperatorRole) &&
    permissions !== null
  )
}
