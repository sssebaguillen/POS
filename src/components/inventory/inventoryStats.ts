import type { InventoryProduct } from '@/components/inventory/types'

export interface InventoryStats {
  /** Productos activos (is_active) — usado tanto para los KPIs como para el listado. */
  activeProducts: InventoryProduct[]
  totalStock: number
  inventoryValue: number
  /** Margen bruto promedio (%) sobre los productos activos con costo y precio > 0. */
  avgMargin: number
  outOfStock: number
  lowStock: number
  categoryCount: number
}

/**
 * Deriva los KPIs de la cabecera de inventario a partir de la lista de productos.
 * Pura (sin estado ni efectos) — extraída de InventoryPanel para aligerar el
 * componente sin cambiar el cálculo ni la memoización (deps: [products]).
 */
export function computeInventoryStats(products: InventoryProduct[]): InventoryStats {
  const activeProducts = products.filter(p => p.is_active)
  const totalStock = activeProducts.reduce((acc, p) => acc + p.stock, 0)
  const inventoryValue = activeProducts.reduce((acc, p) => acc + p.cost * p.stock, 0)
  const withCost = activeProducts.filter(p => p.cost > 0 && p.price > 0)
  const avgMargin = withCost.length === 0
    ? 0
    : withCost.reduce((acc, p) => acc + ((p.price - p.cost) / p.price) * 100, 0) / withCost.length
  const outOfStock = activeProducts.filter(p => p.stock <= 0).length
  const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const categoryCount = new Set(products.map(p => p.category_id).filter(Boolean)).size
  return { activeProducts, totalStock, inventoryValue, avgMargin, outOfStock, lowStock, categoryCount }
}
