import type { OperatorRole, PaymentMethod } from '@/lib/constants/domain'

export type UserRole = 'owner' | OperatorRole

export type Plan = 'free' | 'basic' | 'standard' | 'pro'

export interface Business {
  id: string
  name: string
  slug: string
  plan: Plan
  settings: Record<string, unknown>
  created_at: string
  whatsapp: string | null
  logo_url: string | null
  description: string | null
}

export interface Profile {
  id: string
  business_id: string
  role: UserRole
  name: string
  pin: string | null
  created_at: string
  avatar_url: string | null
  onboarding_state: Record<string, unknown> | null
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
  has_variants: boolean
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
  credit_limit: number
  is_credit_enabled: boolean
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
  session_id: string | null
  operator_id: string | null
  price_list_id: string | null
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
  unit_price_override: number | null
  override_reason: string | null
  free_line_description: string | null
  total: number
}

export interface Payment {
  id: string
  sale_id: string
  method: PaymentMethod
  amount: number
  reference: string | null
  status: 'completed' | 'pending' | 'refunded' | 'cancelled'
  created_at: string
}

export interface PriceList {
  id: string
  business_id: string
  name: string
  description: string | null
  multiplier: number
  created_at: string
  // Redondeo aplicado al precio de esta lista (costo × mult). null = sin redondeo.
  rounding_step: number | null
  rounding_up: boolean
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

export interface DailySnapshotRow {
  snapshot_date: string
  sales_count: number
  items_sold: number
  gross_revenue: number
  discounts_total: number
  net_revenue: number
  avg_ticket: number
  customers_count: number
  expenses_total: number
  operating_expenses_total: number
  inventory_expenses_total: number
  top_product_id: string | null
  top_product_name: string | null
  top_product_units: number
  top_product_revenue: number
}

export interface StatsTrendsPeriodTotals {
  from: string
  to: string
  net_revenue: number
  gross_revenue: number
  discounts_total: number
  expenses_total: number
  operating_expenses_total: number
  inventory_expenses_total: number
  sales_count: number
  items_sold: number
  customers_count: number
  avg_ticket: number
}

export interface StatsTrendsDayRow {
  day_offset: number
  current_date: string
  previous_date: string
  current_net_revenue: number
  current_expenses: number
  current_sales_count: number
  current_avg_ticket: number
  previous_net_revenue: number
  previous_expenses: number
  previous_sales_count: number
  previous_avg_ticket: number
}

export interface StatsTrendsComparison {
  current: StatsTrendsPeriodTotals
  previous: StatsTrendsPeriodTotals
  days: StatsTrendsDayRow[]
}

export interface SalesHeatmapCell {
  weekday: number   // Postgres DOW: 0=Sunday … 6=Saturday
  hour: number      // 0..23, business-local timezone
  sales_count: number
  net_revenue: number
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
  method: PaymentMethod
  revenue: number
  count: number
}

export interface StatsBreakdownOperator {
  operator_id: string | null
  operator_name: string
  revenue: number
  count: number
}

export interface OperatorSalesStatsRow {
  operator_id: string | null
  operator_name: string
  role: UserRole
  transactions: number
  total_revenue: number
  avg_ticket: number
  units_sold: number
}

// Stock inmovilizado / capital inmovilizado (advanced analytics) — RPC get_dead_stock
// Eje RECENCIA: never_sold (nunca vendió) | dead (lleva >= 90d sin moverse).
// El eje cobertura (sobrestock) vive en una pantalla aparte (lente 2, pendiente).
export type DeadStockBucket = 'never_sold' | 'dead'

export interface DeadStockRow {
  id: string
  name: string
  sku: string | null
  category_name: string | null
  brand_name: string | null
  is_active: boolean | null
  image_url: string | null
  image_source: string | null
  has_variants: boolean
  effective_stock: number
  frozen_capital: number
  unit_cost: number | null          // null cuando el producto tiene variantes (costo por variante)
  last_sold_at: string | null
  days_since_last_sale: number | null
  age_days: number
  bucket: DeadStockBucket
  missing_cost: boolean             // stock > 0 pero capital = 0 (costo sin cargar)
}

export interface DeadStockSummary {
  total_frozen_capital: number
  products_with_stock: number       // todos los productos con stock (denominador)
  products_flagged: number          // productos sin rotación (suma de buckets)
  products_missing_cost: number
  count_by_bucket: Record<DeadStockBucket, number>
  capital_by_bucket: Record<DeadStockBucket, number>
}

// Sobrestock / capital comprado de más (advanced analytics) — RPC get_overstock
// Eje COBERTURA: productos que SÍ rotan pero con >= 6 meses de stock para su ritmo.
export interface OverstockRow {
  id: string
  name: string
  sku: string | null
  category_name: string | null
  brand_name: string | null
  is_active: boolean | null
  image_url: string | null
  image_source: string | null
  has_variants: boolean
  effective_stock: number
  frozen_capital: number            // capital total inmovilizado en el stock
  monthly_velocity: number          // u/mes (units_90d ÷ min(90,age)/30)
  months_of_stock: number           // cobertura = stock ÷ velocidad
  excess_capital: number            // lo que pasa de 6 meses de cobertura
  age_days: number
}

export interface OverstockSummary {
  total_excess_capital: number      // suma de excedentes (titular)
  total_overstock_capital: number   // capital total de los productos con sobrestock
  products_count: number
}

// Selector de lente en /stats/inventory-health (Salud de inventario)
export type InventoryHealthLens = 'dead' | 'overstock'

// Historial de ventas paginado server-side (dashboard) — RPC get_sales_history
export interface SalesHistoryRow {
  id: string
  created_at: string
  subtotal: number
  discount: number
  total: number
  status: string | null
  method: PaymentMethod | null      // método del pago más temprano; null si no hay pago
  operator_name: string | null      // null = dueño
}

export interface SalesHistorySummary {
  count: number
  total_revenue: number
  top_method: PaymentMethod | null
}

// Una página de la RPC: total/summary solo vienen en la primera (cursor null)
export interface SalesHistoryPage {
  data: SalesHistoryRow[]
  total: number | null
  summary: SalesHistorySummary | null
}

// Operador para el dropdown de filtro del historial
export interface SalesHistoryOperator {
  id: string
  name: string
}

// Cart types (client-side only)
export interface CartItem {
  product: Product | null
  free_line_id: string | null
  free_line_description: string | null
  variant_id: string | null
  variant_label: string | null
  variant_stock?: number | null
  variant_cost?: number
  variant_base_price?: number
  quantity: number
  unit_price: number
  total: number
  priceIsManual?: boolean
}

export function getCartItemId(item: CartItem): string {
  if (item.free_line_id) return item.free_line_id
  if (item.variant_id) return `${item.product!.id}:${item.variant_id}`
  return item.product!.id
}

export interface AttributeType {
  id: string
  label: string
  position: number
}

export interface ProductOptionValue {
  id: string
  option_id: string
  value: string
  position: number
}

export interface ProductOption {
  id: string
  product_id: string
  attribute_type_id: string
  name: string
  position: number
  values: ProductOptionValue[]
}

export interface ProductVariant {
  id: string
  product_id: string
  sku: string | null
  barcode: string | null
  price: number
  cost: number
  stock: number
  min_stock: number
  image_url: string | null
  image_source: 'upload' | 'url' | null
  is_active: boolean
  is_in_stock: boolean
  option_values: { option_id: string; option_value_id: string; value: string }[]
}

export interface ProductWithVariants {
  product: Product
  options: ProductOption[]
  variants: ProductVariant[]
}
