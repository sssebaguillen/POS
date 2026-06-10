export type ActivityEntityType =
  | 'sale'
  | 'product'
  | 'category'
  | 'brand'
  | 'expense'
  | 'supplier'
  | 'price_list'
  | 'promotion'
  | 'setting'
  | 'operator'
  | 'customer'
  | 'catalog_order'

export type ActivityEntityFilter = 'all' | ActivityEntityType

export interface ActivityFilterOperator {
  id: string
  name: string
}

export interface ActivityLookups {
  categoryMap: Record<string, { name: string; icon: string | null; icon_color: string | null }>
  brandMap: Record<string, string>
  productMap: Record<string, string>
  customerMap: Record<string, string>
}

export interface ActivityLogRow {
  id: string
  operator_id: string | null
  actor_role: 'owner' | 'manager' | 'cashier' | 'custom' | 'customer'
  action: string
  entity_type: ActivityEntityType
  entity_id: string
  entity_label: string | null
  actor_name: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

export type ActivityActionTone = 'created' | 'updated' | 'deleted' | 'bulk'
