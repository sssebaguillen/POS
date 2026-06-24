import type { InventoryProduct } from '@/components/inventory/types'
import { getStatus } from '@/components/inventory/types'
import type { ProductFilterValue } from '@/components/shared/ProductFilter'

/** Vista pill del filtro de estado (la misma que usa el resaltado de pills). */
type StatusFilter = 'all' | 'low' | 'out' | 'discontinued'

export interface InventoryFilterCriteria {
  query: string
  categoryIds: string[]
  brandIds: string[]
  statusFilter: StatusFilter
  stockStatus: ProductFilterValue['stockStatus']
  showInCatalogOnly: boolean
}

/**
 * Filtra la lista de productos del inventario por búsqueda, categoría, marca,
 * estado de stock y "solo en catálogo". Pura (sin estado ni efectos) — extraída
 * de InventoryPanel sin cambiar los criterios; siempre devuelve un array nuevo
 * (igual que `products.filter(...)` del useMemo original).
 */
export function filterProducts(
  products: InventoryProduct[],
  { query, categoryIds, brandIds, statusFilter, stockStatus, showInCatalogOnly }: InventoryFilterCriteria,
): InventoryProduct[] {
  const q = query.trim().toLowerCase()
  const catalogOnly = stockStatus === 'catalog-only' || showInCatalogOnly
  return products.filter(product => {
    const status = getStatus(product)
    const matchesQuery =
      q.length === 0 ||
      product.name.toLowerCase().includes(q) ||
      (product.sku ?? '').toLowerCase().includes(q) ||
      (product.barcode ?? '').toLowerCase().includes(q)
    const matchesCategory =
      categoryIds.length === 0 ||
      (product.category_id !== null && categoryIds.includes(product.category_id))
    const matchesBrand =
      brandIds.length === 0 ||
      (product.brand_id != null && brandIds.includes(product.brand_id))
    const matchesStatus = statusFilter === 'all' || status === statusFilter
    const matchesCatalog = !catalogOnly || product.show_in_catalog === true
    return matchesQuery && matchesCategory && matchesBrand && matchesStatus && matchesCatalog
  })
}
