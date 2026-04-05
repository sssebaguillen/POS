export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'mercadopago' | 'credit'

export interface SaleItemInput {
  product_id: string | null
  quantity: number
  unit_price: number
  total: number
}

export interface ReceiptItemInput extends SaleItemInput {
  name: string
  icon: string | null
}

export interface ReceiptData {
  saleId: string
  businessName: string
  createdAt: string
  items: ReceiptItemInput[]
  subtotal: number
  discount: number
  total: number
  paymentMethod: PaymentMethod
  cashReceived: number | null
  change: number
}
