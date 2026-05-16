export type ActivityEntityFilter = 'all' | 'sale' | 'product' | 'category' | 'brand'

export interface ActivityFilterOperator {
  id: string
  name: string
  role: string
}

export interface ActivityLogRow {
  id: string
  operator_id: string | null
  actor_role: 'owner' | 'manager' | 'cashier' | 'custom'
  action: string
  entity_type: 'sale' | 'product' | 'category' | 'brand'
  entity_id: string
  entity_label: string | null
  actor_name: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

export type ActivityActionTone = 'created' | 'updated' | 'deleted' | 'bulk'
