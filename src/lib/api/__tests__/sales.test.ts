import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrapRpc } from '@/lib/api/_helpers'
import {
  createSaleTransaction,
  getSaleDetail,
  updateSale,
  deleteSale,
} from '@/lib/api/sales'

// --- unwrapRpc (RPC envelope contract) ---

describe('unwrapRpc', () => {
  it('returns ok:true with data when the envelope reports success', () => {
    const result = unwrapRpc<{ sale_id: string }>(
      { data: { success: true, sale_id: 's-1' }, error: null },
      'fallback'
    )
    expect(result).toEqual({ ok: true, data: { success: true, sale_id: 's-1' } })
  })

  it('returns ok:false with a translated message on a Postgrest error', () => {
    const result = unwrapRpc(
      { data: null, error: { message: 'duplicate key value', details: '', hint: '', code: '23505', name: 'e', toJSON: () => ({ name: 'e', message: 'duplicate key value', details: '', hint: '', code: '23505' }) } },
      'fallback'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Ya existe un registro con esos datos.')
  })

  it('uses the envelope error when success is false', () => {
    const result = unwrapRpc(
      { data: { success: false, error: 'Sin stock' }, error: null },
      'fallback'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Sin stock')
  })

  it('uses the fallback when data is null and there is no error', () => {
    const result = unwrapRpc({ data: null, error: null }, 'fallback message')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('fallback message')
  })

  it('uses the fallback when the envelope omits an error string', () => {
    const result = unwrapRpc({ data: { success: false }, error: null }, 'fallback message')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('fallback message')
  })
})

// --- RPC wrappers ---

function makeRpcMock(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('createSaleTransaction', () => {
  it('calls create_sale_transaction with mapped parameters and unwraps the result', async () => {
    const { client, rpc } = makeRpcMock({ data: { success: true, sale_id: 's-1' }, error: null })
    const result = await createSaleTransaction(
      client,
      {
        businessId: 'biz-1',
        subtotal: 100,
        discount: 10,
        total: 90,
        status: 'completed',
        priceListId: null,
        operatorId: 'op-1',
        items: [
          {
            product_id: 'p-1',
            variant_id: null,
            quantity: 1,
            unit_price: 100,
            total: 100,
            unit_price_override: null,
            override_reason: null,
            free_line_description: null,
            promotion_id: null,
            promo_discount: 0,
          },
        ],
        payments: [{ method: 'cash', amount: 90 }],
        customerId: null,
        sessionId: 'sess-1',
      },
      'No se pudo registrar la venta.'
    )

    expect(rpc).toHaveBeenCalledWith('create_sale_transaction', expect.objectContaining({
      p_business_id: 'biz-1',
      p_subtotal: 100,
      p_discount: 10,
      p_total: 90,
      p_status: 'completed',
      p_price_list_id: null,
      p_operator_id: 'op-1',
      p_customer_id: null,
      p_session_id: 'sess-1',
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.sale_id).toBe('s-1')
  })

  it('surfaces a translated DB error', async () => {
    const { client } = makeRpcMock({
      data: null,
      error: { message: 'Stock insuficiente', details: '', hint: '', code: 'P0001', name: 'e' },
    })
    const result = await createSaleTransaction(
      client,
      {
        businessId: 'biz-1', subtotal: 0, discount: 0, total: 0, status: 'completed',
        priceListId: null, operatorId: null, items: [], payments: [], customerId: null, sessionId: null,
      },
      'No se pudo registrar la venta.'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Stock insuficiente para completar la operación.')
  })
})

describe('getSaleDetail', () => {
  it('calls get_sale_detail with sale and business ids', async () => {
    const { client, rpc } = makeRpcMock({
      data: { success: true, status: 'completed', payment_method: 'cash', operator_name: 'Ana', items: [] },
      error: null,
    })
    const result = await getSaleDetail(client, { saleId: 's-1', businessId: 'biz-1' })
    expect(rpc).toHaveBeenCalledWith('get_sale_detail', { p_sale_id: 's-1', p_business_id: 'biz-1' })
    expect(result.ok).toBe(true)
  })
})

describe('updateSale', () => {
  it('passes status as null by default', async () => {
    const { client, rpc } = makeRpcMock({ data: { success: true, total: 50 }, error: null })
    await updateSale(client, {
      saleId: 's-1',
      businessId: 'biz-1',
      items: [{ product_id: 'p-1', variant_id: null, quantity: 1, unit_price: 50 }],
      paymentMethod: 'cash',
      operatorId: null,
    })
    expect(rpc).toHaveBeenCalledWith('update_sale', expect.objectContaining({
      p_sale_id: 's-1',
      p_business_id: 'biz-1',
      p_payment_method: 'cash',
      p_operator_id: null,
      p_status: null,
    }))
  })

  it('forwards an explicit status', async () => {
    const { client, rpc } = makeRpcMock({ data: { success: true, total: 0 }, error: null })
    await updateSale(client, {
      saleId: 's-1', businessId: 'biz-1', items: [], paymentMethod: 'card', operatorId: 'op-1', status: 'cancelled',
    })
    expect(rpc).toHaveBeenCalledWith('update_sale', expect.objectContaining({ p_status: 'cancelled' }))
  })
})

describe('deleteSale', () => {
  it('calls delete_sale with the operator id for audit attribution', async () => {
    const { client, rpc } = makeRpcMock({ data: { success: true }, error: null })
    const result = await deleteSale(client, { saleId: 's-1', businessId: 'biz-1', operatorId: 'op-1' })
    expect(rpc).toHaveBeenCalledWith('delete_sale', {
      p_sale_id: 's-1',
      p_business_id: 'biz-1',
      p_operator_id: 'op-1',
    })
    expect(result.ok).toBe(true)
  })
})
