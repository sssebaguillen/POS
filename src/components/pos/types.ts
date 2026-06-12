import type { Product } from '@/lib/types'
import type { PaymentMethod } from '@/lib/constants/domain'

export interface PosCategory {
  id: string
  name: string
  icon: string
}

export interface ProductWithCategory extends Product {
  brand?: { id: string; name: string } | null
  categories?: { name: string; icon: string } | null
  // price/cost de cada variante activa — la card calcula el "Desde" con el mínimo
  // efectivo (lista + promo), no con la variante default (que puede ser la más cara)
  variant_prices?: { price: number; cost: number }[]
}

export type ActiveFilter =
  | { type: 'category'; id: string }
  | { type: 'brand'; id: string }
  | null

export interface SaleRow {
  id: string
  subtotal: number
  discount: number
  created_at: string
  total: number
  status: string | null
  payment_method: PaymentMethod | null
  item_count?: number               // suma de cantidades (preview en fila colapsada)
  item_icons?: { icon: string | null; color: string | null }[] // íconos de categoría de los primeros items
}

export interface SaleItem {
  id: string
  product_id: string | null
  variant_id: string | null
  variant_label: string | null
  product_name: string
  product_icon: string | null
  product_icon_color: string | null
  quantity: number
  unit_price: number
  free_line_description: string | null
}

export interface SaleDetail extends SaleRow {
  items: SaleItem[]
  operator_name: string | null
  customer_name: string | null
}