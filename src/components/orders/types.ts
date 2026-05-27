export type CatalogOrderStatus =
  | 'recibido'
  | 'aceptado'
  | 'en_camino'
  | 'listo_retiro'
  | 'completado'
  | 'rechazado'
  | 'cancelado'

export type CatalogOrderDeliveryType = 'takeaway' | 'delivery'

export interface CatalogOrderRow {
  id: string
  order_number: number
  customer_name: string
  customer_phone: string
  delivery_type: CatalogOrderDeliveryType
  status: CatalogOrderStatus
  subtotal: number
  total: number
  item_count: number
  created_at: string
  accepted_at: string | null
  completed_at: string | null
  sale_id: string | null
}

export interface CatalogOrderItemRow {
  id: string
  order_id: string
  product_id: string | null
  product_name: string
  variant_id: string | null
  variant_label: string | null
  quantity: number
  unit_price: number
  line_total: number
  image_url: string | null
}

export interface CatalogOrderDetail {
  id: string
  business_id: string
  order_number: number
  customer_name: string
  customer_phone: string
  delivery_type: CatalogOrderDeliveryType
  address: string | null
  notes: string | null
  status: CatalogOrderStatus
  subtotal: number
  total: number
  sale_id: string | null
  created_at: string
  updated_at: string
  accepted_at: string | null
  completed_at: string | null
  rejected_at: string | null
  cancelled_at: string | null
}

export const STATUS_LABEL: Record<CatalogOrderStatus, string> = {
  recibido: 'Recibido',
  aceptado: 'Aceptado',
  en_camino: 'En camino',
  listo_retiro: 'Listo para retirar',
  completado: 'Completado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
}

