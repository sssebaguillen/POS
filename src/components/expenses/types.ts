export type ExpenseCategory =
  | 'mercaderia'
  | 'alquiler'
  | 'servicios'
  | 'seguros'
  | 'proveedores'
  | 'sueldos'
  | 'otro'

export type ExpenseAttachmentType = 'image' | 'pdf' | 'spreadsheet' | 'other'

export interface Expense {
  id: string
  business_id: string
  operator_id: string | null
  supplier_id: string | null
  category: ExpenseCategory
  amount: number
  description: string
  date: string
  attachment_url: string | null
  attachment_type: ExpenseAttachmentType | null
  attachment_name: string | null
  notes: string | null
  created_at: string
  updated_at: string
  supplier?: { id: string; name: string } | null
  item_count?: number
}

export interface MercaderiaItem {
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number
  update_cost: boolean
  _original_cost: number
}

export interface Supplier {
  id: string
  business_id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_at: string
}

export interface BusinessBalance {
  income: number
  expenses: number
  profit: number
  margin: number
  by_category: Record<string, number>
  period_from: string
  period_to: string
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  mercaderia: 'Mercadería',
  alquiler: 'Alquiler',
  servicios: 'Servicios',
  seguros: 'Seguros',
  proveedores: 'Proveedores',
  sueldos: 'Sueldos',
  otro: 'Otro',
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'mercaderia',
  'alquiler',
  'servicios',
  'seguros',
  'proveedores',
  'sueldos',
  'otro',
]
