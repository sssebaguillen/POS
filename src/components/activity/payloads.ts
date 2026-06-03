import type { ActivityEntityType } from '@/components/activity/types'

export type ActivityAction =
  | 'catalog_order_creado'
  | 'catalog_order_aceptado'
  | 'catalog_order_rechazado'
  | 'catalog_order_cancelado'
  | 'catalog_order_en_camino'
  | 'catalog_order_listo_retiro'
  | 'catalog_order_completado'
  | 'sale_created'
  | 'sale_updated'
  | 'sale_deleted'
  | 'product_created'
  | 'product_updated'
  | 'product_deleted'
  | 'product_variants_created'
  | 'product_variants_updated'
  | 'product_bulk_deleted'
  | 'product_bulk_status'
  | 'product_bulk_catalog'
  | 'product_bulk_category'
  | 'product_bulk_brand'
  | 'category_created'
  | 'category_updated'
  | 'category_deleted'
  | 'brand_created'
  | 'brand_updated'
  | 'brand_deleted'
  | 'expense_created'
  | 'expense_updated'
  | 'expense_deleted'
  | 'supplier_created'
  | 'supplier_updated'
  | 'supplier_deactivated'
  | 'price_list_created'
  | 'price_list_updated'
  | 'price_list_deleted'
  | 'price_list_default_changed'
  | 'settings_updated'
  | 'settings_slug_updated'
  | 'operator_created'
  | 'operator_updated'
  | 'operator_deleted'
  | 'customer_created'
  | 'customer_updated'
  | 'customer_credit_settled'

export interface SaleItem {
  product_id?: string | null
  variant_id?: string | null
  quantity?: number | string
  unit_price?: number | string
  total?: number | string
}

export interface SalePayment {
  method?: string
  amount?: number | string
}

export interface SaleData {
  total?: number | string
  subtotal?: number | string
  discount?: number | string
  status?: string
  customer_id?: string | null
  items?: SaleItem[]
  payments?: SalePayment[]
  payment_methods?: string[]
  item_count?: number
}

export interface ProductData {
  name?: string
  price?: number | string
  cost?: number | string
  stock?: number | string
  min_stock?: number | string | null
  is_active?: boolean
  category_id?: string | null
  brand_id?: string | null
}

// Snapshot generado por product_variants_snapshot(...) en Postgres.
// Usado en payloads de product_variants_created y product_variants_updated.

export interface ProductVariantOptionValueSnapshot {
  option_id?: string
  option_name?: string | null
  option_value_id?: string
  value?: string | null
}

export interface ProductVariantSnapshot {
  id?: string
  sku?: string | null
  barcode?: string | null
  price?: number | string
  cost?: number | string
  stock?: number | string
  min_stock?: number | string
  is_active?: boolean
  option_values?: ProductVariantOptionValueSnapshot[]
}

export interface ProductOptionValueSnapshot {
  id?: string
  value?: string
  position?: number
}

export interface ProductOptionSnapshot {
  id?: string
  attribute_type_id?: string
  name?: string
  position?: number
  values?: ProductOptionValueSnapshot[]
}

export interface ProductVariantsData {
  product?: {
    id?: string
    name?: string
    has_variants?: boolean
    default_variant_id?: string | null
  } | null
  options?: ProductOptionSnapshot[]
  variants?: ProductVariantSnapshot[]
}

export interface CategoryData {
  name?: string
  icon?: string | null
  icon_color?: string | null
}

export interface BrandData {
  name?: string
}

export interface BulkData {
  product_ids?: string[]
  // Snapshot inmutable {id, name} al momento del evento (entradas nuevas).
  // Entradas viejas no lo tienen → fallback a product_ids→productMap.
  products?: { id: string; name: string }[]
  count?: number
  is_active?: boolean
  show_in_catalog?: boolean
  category_id?: string | null
  brand_id?: string | null
}

export interface ExpenseLineItem {
  product_id?: string | null
  product_name?: string | null
  variant_id?: string | null
  variant_label?: string | null
  quantity?: number | string
  unit_cost?: number | string
  update_cost?: boolean
}

export interface ExpenseData {
  category?: string | null
  amount?: number | string
  description?: string | null
  date?: string | null
  supplier_id?: string | null
  notes?: string | null
  items?: ExpenseLineItem[]
  item_count?: number
}

export interface SupplierData {
  name?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  is_active?: boolean
}

export interface PriceListData {
  id?: string
  name?: string | null
  description?: string | null
  multiplier?: number | string
  is_default?: boolean
}

export interface PriceListCreateData {
  list?: PriceListData | null
  overrides_count?: number
}

export interface PriceListUpdateData {
  list?: PriceListData | null
  overrides_upserted?: unknown[]
  overrides_deleted?: unknown[]
}

export interface SettingsData {
  name?: string | null
  description?: string | null
  whatsapp?: string | null
  logo_url?: string | null
  settings?: Record<string, unknown> | null
}

export interface OperatorData {
  name?: string | null
  role?: string | null
  permissions?: Record<string, boolean> | null
  is_active?: boolean
}

export interface OperatorUpdateData extends OperatorData {
  pin_changed?: boolean
}

export interface CustomerData {
  name?: string | null
  phone?: string | null
  email?: string | null
  dni?: string | null
  credit_limit?: number | string | null
  credit_balance?: number | string | null
  is_credit_enabled?: boolean
  notes?: string | null
}

export interface CustomerSettlementOld {
  credit_balance?: number | string | null
}

export interface CustomerSettlementNew {
  credit_balance?: number | string | null
  amount?: number | string | null
  method?: string | null
}

export interface CatalogOrderData {
  id?: string
  order_number?: number | string
  status?: string
  delivery_type?: string
  customer_name?: string
  customer_phone?: string
  address?: string | null
  notes?: string | null
  subtotal?: number | string
  total?: number | string
  sale_id?: string | null
  created_at?: string
  accepted_at?: string | null
  completed_at?: string | null
  rejected_at?: string | null
  cancelled_at?: string | null
}

export interface ActivityPayloadMap {
  catalog_order_creado:       { entityType: 'catalog_order'; oldData: null;                   newData: CatalogOrderData | null }
  catalog_order_aceptado:     { entityType: 'catalog_order'; oldData: CatalogOrderData | null; newData: CatalogOrderData | null }
  catalog_order_rechazado:    { entityType: 'catalog_order'; oldData: CatalogOrderData | null; newData: CatalogOrderData | null }
  catalog_order_cancelado:    { entityType: 'catalog_order'; oldData: CatalogOrderData | null; newData: CatalogOrderData | null }
  catalog_order_en_camino:    { entityType: 'catalog_order'; oldData: CatalogOrderData | null; newData: CatalogOrderData | null }
  catalog_order_listo_retiro: { entityType: 'catalog_order'; oldData: CatalogOrderData | null; newData: CatalogOrderData | null }
  catalog_order_completado:   { entityType: 'catalog_order'; oldData: CatalogOrderData | null; newData: CatalogOrderData | null }
  sale_created: { entityType: 'sale'; oldData: null; newData: SaleData | null }
  sale_updated: { entityType: 'sale'; oldData: SaleData | null; newData: SaleData | null }
  sale_deleted: { entityType: 'sale'; oldData: SaleData | null; newData: null }
  product_created: { entityType: 'product'; oldData: null; newData: ProductData | null }
  product_updated: { entityType: 'product'; oldData: ProductData | null; newData: ProductData | null }
  product_deleted: { entityType: 'product'; oldData: ProductData | null; newData: null }
  product_variants_created: { entityType: 'product'; oldData: null; newData: ProductVariantsData | null }
  product_variants_updated: { entityType: 'product'; oldData: ProductVariantsData | null; newData: ProductVariantsData | null }
  product_bulk_deleted: { entityType: 'product'; oldData: BulkData | null; newData: null }
  product_bulk_status: { entityType: 'product'; oldData: BulkData | null; newData: BulkData | null }
  product_bulk_catalog: { entityType: 'product'; oldData: BulkData | null; newData: BulkData | null }
  product_bulk_category: { entityType: 'product'; oldData: BulkData | null; newData: BulkData | null }
  product_bulk_brand: { entityType: 'product'; oldData: BulkData | null; newData: BulkData | null }
  category_created: { entityType: 'category'; oldData: null; newData: CategoryData | null }
  category_updated: { entityType: 'category'; oldData: CategoryData | null; newData: CategoryData | null }
  category_deleted: { entityType: 'category'; oldData: CategoryData | null; newData: null }
  brand_created: { entityType: 'brand'; oldData: null; newData: BrandData | null }
  brand_updated: { entityType: 'brand'; oldData: BrandData | null; newData: BrandData | null }
  brand_deleted: { entityType: 'brand'; oldData: BrandData | null; newData: null }
  expense_created: { entityType: 'expense'; oldData: null; newData: ExpenseData | null }
  expense_updated: { entityType: 'expense'; oldData: ExpenseData | null; newData: ExpenseData | null }
  expense_deleted: { entityType: 'expense'; oldData: ExpenseData | null; newData: null }
  supplier_created: { entityType: 'supplier'; oldData: null; newData: SupplierData | null }
  supplier_updated: { entityType: 'supplier'; oldData: SupplierData | null; newData: SupplierData | null }
  supplier_deactivated: { entityType: 'supplier'; oldData: SupplierData | null; newData: null }
  price_list_created: { entityType: 'price_list'; oldData: null; newData: PriceListCreateData | null }
  price_list_updated: { entityType: 'price_list'; oldData: PriceListData | null; newData: PriceListUpdateData | null }
  price_list_deleted: { entityType: 'price_list'; oldData: PriceListData | null; newData: null }
  price_list_default_changed: { entityType: 'price_list'; oldData: null; newData: null }
  settings_updated: { entityType: 'setting'; oldData: SettingsData | null; newData: SettingsData | null }
  settings_slug_updated: { entityType: 'setting'; oldData: { slug?: string } | null; newData: { slug?: string } | null }
  operator_created: { entityType: 'operator'; oldData: null; newData: OperatorData | null }
  operator_updated: { entityType: 'operator'; oldData: OperatorData | null; newData: OperatorUpdateData | null }
  operator_deleted: { entityType: 'operator'; oldData: OperatorData | null; newData: null }
  customer_created: { entityType: 'customer'; oldData: null; newData: CustomerData | null }
  customer_updated: { entityType: 'customer'; oldData: CustomerData | null; newData: CustomerData | null }
  customer_credit_settled: { entityType: 'customer'; oldData: CustomerSettlementOld | null; newData: CustomerSettlementNew | null }
}

export type ActivityPayloadEntityType<TAction extends ActivityAction> = ActivityPayloadMap[TAction]['entityType']

export function readAuditPayload<T>(value: Record<string, unknown> | null): T | null {
  return value as T | null
}

export function isActivityAction(value: string): value is ActivityAction {
  return ACTIVITY_ACTIONS.includes(value as ActivityAction)
}

export const ACTIVITY_ACTIONS: ActivityAction[] = [
  'catalog_order_creado',
  'catalog_order_aceptado',
  'catalog_order_rechazado',
  'catalog_order_cancelado',
  'catalog_order_en_camino',
  'catalog_order_listo_retiro',
  'catalog_order_completado',
  'sale_created',
  'sale_updated',
  'sale_deleted',
  'product_created',
  'product_updated',
  'product_deleted',
  'product_variants_created',
  'product_variants_updated',
  'product_bulk_deleted',
  'product_bulk_status',
  'product_bulk_catalog',
  'product_bulk_category',
  'product_bulk_brand',
  'category_created',
  'category_updated',
  'category_deleted',
  'brand_created',
  'brand_updated',
  'brand_deleted',
  'expense_created',
  'expense_updated',
  'expense_deleted',
  'supplier_created',
  'supplier_updated',
  'supplier_deactivated',
  'price_list_created',
  'price_list_updated',
  'price_list_deleted',
  'price_list_default_changed',
  'settings_updated',
  'settings_slug_updated',
  'operator_created',
  'operator_updated',
  'operator_deleted',
  'customer_created',
  'customer_updated',
  'customer_credit_settled',
]

export const ACTION_ENTITY_TYPES: Record<ActivityAction, ActivityEntityType> = {
  catalog_order_creado:       'catalog_order',
  catalog_order_aceptado:     'catalog_order',
  catalog_order_rechazado:    'catalog_order',
  catalog_order_cancelado:    'catalog_order',
  catalog_order_en_camino:    'catalog_order',
  catalog_order_listo_retiro: 'catalog_order',
  catalog_order_completado:   'catalog_order',
  sale_created: 'sale',
  sale_updated: 'sale',
  sale_deleted: 'sale',
  product_created: 'product',
  product_updated: 'product',
  product_deleted: 'product',
  product_variants_created: 'product',
  product_variants_updated: 'product',
  product_bulk_deleted: 'product',
  product_bulk_status: 'product',
  product_bulk_catalog: 'product',
  product_bulk_category: 'product',
  product_bulk_brand: 'product',
  category_created: 'category',
  category_updated: 'category',
  category_deleted: 'category',
  brand_created: 'brand',
  brand_updated: 'brand',
  brand_deleted: 'brand',
  expense_created: 'expense',
  expense_updated: 'expense',
  expense_deleted: 'expense',
  supplier_created: 'supplier',
  supplier_updated: 'supplier',
  supplier_deactivated: 'supplier',
  price_list_created: 'price_list',
  price_list_updated: 'price_list',
  price_list_deleted: 'price_list',
  price_list_default_changed: 'price_list',
  settings_updated: 'setting',
  settings_slug_updated: 'setting',
  operator_created: 'operator',
  operator_updated: 'operator',
  operator_deleted: 'operator',
  customer_created: 'customer',
  customer_updated: 'customer',
  customer_credit_settled: 'customer',
}
