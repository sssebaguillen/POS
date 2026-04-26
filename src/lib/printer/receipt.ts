import type { ReceiptData, ReceiptItemInput } from '@/lib/printer/types'
import { isPaymentMethod } from '@/lib/payments'

interface ReceiptSaleItemSource {
  product_id: string | null
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface ReceiptSaleSource {
  id: string
  created_at: string
  subtotal: number
  discount: number
  total: number
  paymentMethod: string | null
}

interface BuildReceiptDataParams {
  businessName: string
  sale: ReceiptSaleSource
  items: ReceiptSaleItemSource[]
  currency?: string
}

export function buildReceiptData({ businessName, sale, items, currency }: BuildReceiptDataParams): ReceiptData {
  if (!isPaymentMethod(sale.paymentMethod)) {
    throw new Error('No se pudo identificar el metodo de pago de la venta.')
  }

  const receiptItems: ReceiptItemInput[] = items.map(item => ({
    product_id: item.product_id,
    name: item.product_name,
    icon: item.product_icon,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total: item.quantity * item.unit_price,
    unit_price_override: null,
    override_reason: null,
  }))

  return {
    saleId: sale.id,
    businessName,
    createdAt: sale.created_at,
    items: receiptItems,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    cashReceived: null,
    change: 0,
    currency: currency ?? 'ARS',
  }
}
