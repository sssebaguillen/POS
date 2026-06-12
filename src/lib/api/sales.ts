import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentMethod } from '@/lib/constants/domain'
import { unwrapRpc, type RpcResult } from './_helpers'

export interface SaleItemRow {
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

export interface SaleDetailPayload {
  status: string | null
  payment_method: string | null
  operator_name: string | null
  customer_name: string | null
  items: SaleItemRow[] | null
}

export interface UpdateSaleItem {
  product_id: string | null
  variant_id: string | null
  quantity: number
  unit_price: number
}

export interface UpdateSalePayload {
  total: number
}

export interface CreateSaleItem {
  product_id: string | null
  variant_id: string | null
  quantity: number
  unit_price: number
  total: number
  unit_price_override: number | null
  override_reason: string | null
  free_line_description: string | null
  promotion_id: string | null
  promo_discount: number
}

export interface CreateSalePayment {
  method: string
  amount: number
}

export interface CreateSalePayload {
  sale_id?: string
  created_at?: string
}

export async function createSaleTransaction(
  supabase: SupabaseClient,
  params: {
    businessId: string
    subtotal: number
    discount: number
    total: number
    status: string
    priceListId: string | null
    operatorId: string | null
    items: CreateSaleItem[]
    payments: CreateSalePayment[]
    customerId: string | null
    sessionId: string | null
  },
  fallbackError: string
): Promise<RpcResult<CreateSalePayload>> {
  const response = await supabase.rpc('create_sale_transaction', {
    p_business_id: params.businessId,
    p_subtotal: params.subtotal,
    p_discount: params.discount,
    p_total: params.total,
    p_status: params.status,
    p_price_list_id: params.priceListId,
    p_operator_id: params.operatorId,
    p_items: params.items,
    p_payments: params.payments,
    p_customer_id: params.customerId,
    p_session_id: params.sessionId,
  })
  return unwrapRpc<CreateSalePayload>(response, fallbackError)
}

export async function getSaleDetail(
  supabase: SupabaseClient,
  params: { saleId: string; businessId: string }
): Promise<RpcResult<SaleDetailPayload>> {
  const response = await supabase.rpc('get_sale_detail', {
    p_sale_id: params.saleId,
    p_business_id: params.businessId,
  })
  return unwrapRpc<SaleDetailPayload>(response, 'No se pudo cargar el detalle de la venta.')
}

export async function updateSale(
  supabase: SupabaseClient,
  params: {
    saleId: string
    businessId: string
    items: UpdateSaleItem[]
    paymentMethod: PaymentMethod
    operatorId: string | null
    status?: string | null
  }
): Promise<RpcResult<UpdateSalePayload>> {
  const response = await supabase.rpc('update_sale', {
    p_sale_id: params.saleId,
    p_business_id: params.businessId,
    p_items: params.items,
    p_payment_method: params.paymentMethod,
    p_operator_id: params.operatorId,
    p_status: params.status ?? null,
  })
  return unwrapRpc<UpdateSalePayload>(response, 'No se pudo actualizar la venta.')
}

export async function deleteSale(
  supabase: SupabaseClient,
  params: { saleId: string; businessId: string; operatorId: string | null }
): Promise<RpcResult<Record<string, never>>> {
  const response = await supabase.rpc('delete_sale', {
    p_sale_id: params.saleId,
    p_business_id: params.businessId,
    p_operator_id: params.operatorId,
  })
  return unwrapRpc<Record<string, never>>(response, 'No se pudo eliminar la venta.')
}
