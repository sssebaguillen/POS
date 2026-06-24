import type { InventoryProduct } from '@/components/inventory/types'
import type { ProductFilterValue } from '@/components/shared/ProductFilter'

type SortField = ProductFilterValue['sortField']
type SortDir = ProductFilterValue['sortDir']

/**
 * Ordena la lista de productos del inventario por el campo/dirección elegidos.
 * Pura (sin estado ni efectos) — extraída de InventoryPanel sin cambiar el orden.
 * El caso 'name'+'asc' devuelve el array recibido tal cual (sin copiar), igual que
 * el useMemo original, para preservar la identidad referencial.
 */
export function sortProducts(
  products: InventoryProduct[],
  sortField: SortField,
  sortDir: SortDir,
): InventoryProduct[] {
  if (sortField === 'name' && sortDir === 'asc') return products
  const arr = [...products]
  if (sortField === 'name') {
    arr.sort((a, b) => b.name.localeCompare(a.name))
    return arr
  }
  arr.sort((a, b) => {
    let va = 0
    let vb = 0
    if (sortField === 'price') { va = a.price; vb = b.price }
    else if (sortField === 'cost') { va = a.cost; vb = b.cost }
    else if (sortField === 'stock') { va = a.stock; vb = b.stock }
    else if (sortField === 'margin') {
      va = a.cost > 0 && a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : 0
      vb = b.cost > 0 && b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : 0
    }
    return sortDir === 'asc' ? va - vb : vb - va
  })
  return arr
}
