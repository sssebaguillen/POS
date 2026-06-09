import type { Product } from '@/lib/types'

// Tipos del carrito del POS — solo cliente. Separados del índice de tipos de entidades
// del server (`@/lib/types`) para no mezclar estado de UI con el modelo de datos.

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
