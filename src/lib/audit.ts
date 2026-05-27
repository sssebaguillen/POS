import type { ActivityActionTone } from '@/components/activity/types'

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  sale_created:               'Venta creada',
  sale_updated:               'Venta editada',
  sale_deleted:               'Venta eliminada',
  product_created:            'Producto creado',
  product_updated:            'Producto editado',
  product_deleted:            'Producto eliminado',
  product_variants_created:   'Producto con variantes creado',
  product_variants_updated:   'Variantes editadas',
  product_bulk_deleted:       'Productos eliminados (masivo)',
  product_bulk_status:        'Estado de productos (masivo)',
  product_bulk_category:      'Categoría de productos (masivo)',
  product_bulk_brand:         'Marca de productos (masivo)',
  category_created:           'Categoría creada',
  category_updated:           'Categoría editada',
  category_deleted:           'Categoría eliminada',
  brand_created:              'Marca creada',
  brand_updated:              'Marca editada',
  brand_deleted:              'Marca eliminada',
  expense_created:            'Gasto creado',
  expense_updated:            'Gasto editado',
  expense_deleted:            'Gasto eliminado',
  supplier_created:           'Proveedor creado',
  supplier_updated:           'Proveedor editado',
  supplier_deactivated:       'Proveedor desactivado',
  price_list_created:         'Lista de precios creada',
  price_list_updated:         'Lista de precios editada',
  price_list_deleted:         'Lista de precios eliminada',
  price_list_default_changed: 'Lista de precios predeterminada',
  settings_updated:           'Configuración actualizada',
  settings_slug_updated:      'Slug actualizado',
  operator_created:           'Operario creado',
  operator_updated:           'Operario editado',
  operator_deleted:           'Operario eliminado',
  customer_created:           'Cliente creado',
  customer_updated:           'Cliente editado',
  customer_credit_settled:    'Pago de cuenta corriente',
  catalog_order_creado:       'Pedido online recibido',
  catalog_order_aceptado:     'Pedido aceptado',
  catalog_order_rechazado:    'Pedido rechazado',
  catalog_order_cancelado:    'Pedido cancelado',
  catalog_order_en_camino:    'Pedido en camino',
  catalog_order_listo_retiro: 'Pedido listo para retirar',
  catalog_order_completado:   'Pedido completado',
}

export const AUDIT_TONE_CLASSES: Record<ActivityActionTone, string> = {
  created: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  updated: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  deleted: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  bulk:    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
}

export function getAuditActionTone(action: string): ActivityActionTone {
  if (action.includes('bulk')) return 'bulk'
  if (action === 'catalog_order_creado') return 'created'
  if (action === 'catalog_order_rechazado' || action === 'catalog_order_cancelado') return 'deleted'
  if (action.startsWith('catalog_order_')) return 'updated'
  if (action.endsWith('_created')) return 'created'
  if (action.endsWith('_updated')) return 'updated'
  if (action.endsWith('_deleted')) return 'deleted'
  return 'updated'
}

export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}
