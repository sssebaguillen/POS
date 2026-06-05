import { describe, it, expect } from 'vitest'
import {
  isPaymentMethod,
  normalizePayment,
  PAYMENT_OPTIONS,
  PAYMENT_COLORS,
  PAYMENT_BAR_COLORS,
  PAYMENT_LABELS,
} from '@/lib/payments'
import { PAYMENT_METHODS } from '@/lib/constants/domain'

describe('isPaymentMethod', () => {
  it('returns true for all valid payment methods', () => {
    for (const method of PAYMENT_METHODS) {
      expect(isPaymentMethod(method)).toBe(true)
    }
  })

  it('returns false for null', () => {
    expect(isPaymentMethod(null)).toBe(false)
  })

  it('returns false for unknown methods', () => {
    expect(isPaymentMethod('bitcoin')).toBe(false)
    expect(isPaymentMethod('other')).toBe(false)
    expect(isPaymentMethod('')).toBe(false)
  })
})

describe('normalizePayment', () => {
  it('returns "sin dato" for null', () => {
    expect(normalizePayment(null)).toBe('sin dato')
  })

  it('returns the Spanish label for known methods', () => {
    expect(normalizePayment('cash')).toBe('Efectivo')
    expect(normalizePayment('card')).toBe('Tarjeta')
    expect(normalizePayment('transfer')).toBe('Transferencia')
    expect(normalizePayment('mercadopago')).toBe('MercadoPago')
    expect(normalizePayment('credit')).toBe('Cuenta corriente')
  })

  it('passes through unknown methods verbatim', () => {
    expect(normalizePayment('cheque')).toBe('cheque')
  })
})

describe('PAYMENT_OPTIONS', () => {
  it('contains one option per payment method', () => {
    expect(PAYMENT_OPTIONS).toHaveLength(PAYMENT_METHODS.length)
  })

  it('pairs each method value with its label', () => {
    const cash = PAYMENT_OPTIONS.find(o => o.value === 'cash')
    expect(cash?.label).toBe('Efectivo')
  })
})

describe('PAYMENT color maps', () => {
  it('PAYMENT_COLORS has an entry for every method', () => {
    for (const method of PAYMENT_METHODS) {
      expect(PAYMENT_COLORS[method]).toBeTruthy()
    }
  })

  it('PAYMENT_BAR_COLORS has an entry for every method', () => {
    for (const method of PAYMENT_METHODS) {
      expect(PAYMENT_BAR_COLORS[method]).toBeTruthy()
    }
  })

  it('re-exports PAYMENT_LABELS', () => {
    expect(PAYMENT_LABELS.cash).toBe('Efectivo')
  })
})
