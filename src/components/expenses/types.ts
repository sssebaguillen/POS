import { ACCENT_FILL, type AccentTone } from '@/lib/accent-colors'

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
  variant_id: string | null
  variant_label: string | null
  quantity: number
  unit_cost: number
  update_cost: boolean
  _original_cost: number
  /** Current stock at the time the row was added/loaded. Used to compute the after-save preview. */
  stock: number
  /** Saved quantity for items loaded from an existing expense; 0 for newly added lines. The
   *  preview math is: stock_after = stock + (quantity - _original_quantity). */
  _original_quantity: number
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

// Mapeo a tone del palette compartido (lib/accent-colors). No reescribir colores acá —
// igual que PAYMENT_TONE en lib/payments.ts.
export const EXPENSE_CATEGORY_TONE: Record<ExpenseCategory, AccentTone> = {
  mercaderia: 'amber',
  proveedores: 'sky',
  sueldos: 'rose',
  alquiler: 'orange',
  servicios: 'violet',
  seguros: 'teal',
  otro: 'muted',
}

export const EXPENSE_CATEGORY_COLORS: Record<ExpenseCategory, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map(c => [c, ACCENT_FILL[EXPENSE_CATEGORY_TONE[c]]])
) as Record<ExpenseCategory, string>
