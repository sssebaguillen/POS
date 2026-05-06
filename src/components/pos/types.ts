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
}

export interface SaleItem {
  id: string
  product_id: string | null
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
  free_line_description: string | null
}

export interface SaleDetail extends SaleRow {
  items: SaleItem[]
  operator_name: string | null
}