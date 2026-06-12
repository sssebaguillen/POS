import { describe, it, expect } from 'vitest'
import { buildReceiptData } from '@/lib/printer/receipt'

const sale = {
  id: 'sale-abcdef12',
  created_at: '2026-06-15T12:00:00Z',
  subtotal: 300,
  discount: 30,
  total: 270,
  paymentMethod: 'cash' as string | null,
}

const items = [
  { product_id: 'p-1', product_name: 'Café', product_icon: '☕', quantity: 2, unit_price: 100 },
  { product_id: 'p-2', product_name: 'Medialuna', product_icon: null, quantity: 1, unit_price: 100 },
]

describe('buildReceiptData', () => {
  it('maps sale + items into a ReceiptData payload', () => {
    const receipt = buildReceiptData({ businessName: 'Mi Café', sale, items })
    expect(receipt.saleId).toBe('sale-abcdef12')
    expect(receipt.businessName).toBe('Mi Café')
    expect(receipt.subtotal).toBe(300)
    expect(receipt.discount).toBe(30)
    expect(receipt.total).toBe(270)
    expect(receipt.paymentMethod).toBe('cash')
    expect(receipt.items).toHaveLength(2)
  })

  it('computes per-line total as quantity × unit_price', () => {
    const receipt = buildReceiptData({ businessName: 'X', sale, items })
    expect(receipt.items[0].total).toBe(200)
    expect(receipt.items[1].total).toBe(100)
  })

  it('defaults currency to ARS and zeroes cash fields', () => {
    const receipt = buildReceiptData({ businessName: 'X', sale, items })
    expect(receipt.currency).toBe('ARS')
    expect(receipt.cashReceived).toBeNull()
    expect(receipt.change).toBe(0)
  })

  it('honors an explicit currency', () => {
    const receipt = buildReceiptData({ businessName: 'X', sale, items, currency: 'BRL' })
    expect(receipt.currency).toBe('BRL')
  })

  it('throws when the payment method is not a valid method', () => {
    expect(() => buildReceiptData({ businessName: 'X', sale: { ...sale, paymentMethod: null }, items })).toThrow(
      /metodo de pago/
    )
    expect(() =>
      buildReceiptData({ businessName: 'X', sale: { ...sale, paymentMethod: 'bitcoin' }, items })
    ).toThrow()
  })
})
