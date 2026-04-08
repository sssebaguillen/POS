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
  image_source: 'upload' | 'url' | null
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

export interface PriceList {
  id: string
  business_id: string
  name: string
  description: string | null
  multiplier: number
  is_default: boolean
  created_at: string
}

export interface PriceListOverride {
  id: string
  price_list_id: string
  product_id: string | null
  brand_id: string | null
  multiplier: number
}

// Stats RPC response types

export interface StatsKpis {
  total_sales: number
  total_revenue: number
  total_units: number
  avg_ticket: number
  prev_total_sales: number
  prev_total_revenue: number
  prev_total_units: number
  peak_day: string | null
  peak_revenue: number | null
  day_of_week: DayOfWeekEntry[]
  period_from: string
  period_to: string
}

export interface DayOfWeekEntry {
  dow: number
  label: string
  revenue: number
  count: number
}

export interface StatsEvolution {
  granularity: 'day' | 'week'
  data: StatsEvolutionPoint[]
}

export interface StatsEvolutionPoint {
  date: string
  label: string
  revenue: number
  count: number
  prev_revenue: number
  prev_count: number
}

export interface StatsBreakdown {
  by_category: StatsBreakdownCategory[]
  by_brand: StatsBreakdownBrand[]
  by_payment: StatsBreakdownPayment[]
  by_operator: StatsBreakdownOperator[]
}

export interface StatsBreakdownCategory {
  category_id: string | null
  category_name: string
  revenue: number
  units: number
}

export interface StatsBreakdownBrand {
  brand_id: string | null
  brand_name: string
  revenue: number
  units: number
}

export interface StatsBreakdownPayment {
  method: string
  revenue: number
  count: number
}

export interface StatsBreakdownOperator {
  operator_id: string | null
  operator_name: string
  revenue: number
  count: number
}

// Cart types (client-side only)
export interface CartItem {
  product: Product
  quantity: number
  unit_price: number
  total: number
  priceIsManual?: boolean
}
