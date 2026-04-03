export type UserRole = 'owner' | 'manager' | 'cashier' | 'custom'

export type Plan = 'free' | 'basic' | 'standard' | 'pro'

export interface Business {
  id: string
  name: string
  slug: string
  plan: Plan
  settings: Record<string, unknown>
  created_at: string
}

export interface Profile {
  id: string
  business_id: string
  role: UserRole
  name: string
  pin: string | null
  created_at: string
}

export interface Category {
  id: string
  business_id: string
  name: string
  icon: string
  position: number
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  business_id: string
  category_id: string | null
  brand_id: string | null
  name: string
  sku: string | null
  barcode: string | null
  price: number
  cost: number
  stock: number
  min_stock: number
  image_url: string | null
  image_source: string | null
  is_active: boolean
  show_in_catalog: boolean
  sales_count: number
  created_at: string
}

export interface Customer {
  id: string
  business_id: string
  name: string
  phone: string | null
  email: string | null
  dni: string | null
  credit_balance: number
  notes: string | null
  created_at: string
}

export interface CashSession {
  id: string
  business_id: string
  opened_by: string
  closed_by: string | null
  opening_amount: number
  closing_amount: number | null
  expected_amount: number | null
  opened_at: string
  closed_at: string | null
  notes: string | null
}

export interface Sale {
  id: string
  business_id: string
  session_id: string
  customer_id: string | null
  subtotal: number
  discount: number
  total: number
  status: 'completed' | 'cancelled' | 'refunded'
  notes: string | null
  created_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string | null
  quantity: number
  unit_price: number
  total: number
}

export interface Payment {
  id: string
  sale_id: string
  method: 'cash' | 'card' | 'transfer' | 'mercadopago' | 'credit'
  amount: number
  reference: string | null
  status: 'completed' | 'failed' | 'pending'
  created_at: string
}

// Cart types (client-side only)
export interface CartItem {
  product: Product
  quantity: number
  unit_price: number
  total: number
  priceIsManual?: boolean
}
