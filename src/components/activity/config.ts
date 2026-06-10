import type { ActivityEntityFilter, ActivityEntityType } from '@/components/activity/types'

export interface ActivityEntityOption {
  value: ActivityEntityFilter
  label: string
}

export const DEFAULT_ACTIVITY_PERIOD = 'mes'
export const OWNER_OPERATOR_FILTER_VALUE = 'owner'

export const ENTITY_FILTER_VALUES: ActivityEntityFilter[] = [
  'all',
  'sale',
  'product',
  'category',
  'brand',
  'expense',
  'supplier',
  'price_list',
  'promotion',
  'setting',
  'operator',
  'customer',
  'catalog_order',
]

export const ENTITY_PRIMARY_OPTIONS: ActivityEntityOption[] = [
  { value: 'all', label: 'Todas' },
  { value: 'sale', label: 'Ventas' },
  { value: 'product', label: 'Productos' },
  { value: 'category', label: 'Categorías' },
  { value: 'brand', label: 'Marcas' },
  { value: 'expense', label: 'Gastos' },
  { value: 'customer', label: 'Clientes' },
]

export const ENTITY_OVERFLOW_OPTIONS: ActivityEntityOption[] = [
  { value: 'supplier', label: 'Proveedores' },
  { value: 'price_list', label: 'Listas de precios' },
  { value: 'promotion', label: 'Promociones' },
  { value: 'setting', label: 'Configuración' },
  { value: 'operator', label: 'Operarios' },
  { value: 'catalog_order', label: 'Pedidos online' },
]

export const ENTITY_TYPE_LABELS: Record<ActivityEntityType, string> = {
  sale: 'Venta',
  product: 'Producto',
  category: 'Categoría',
  brand: 'Marca',
  expense: 'Gasto',
  supplier: 'Proveedor',
  price_list: 'Lista de precios',
  promotion: 'Promoción',
  setting: 'Configuración',
  operator: 'Operario',
  customer: 'Cliente',
  catalog_order: 'Pedido online',
}
