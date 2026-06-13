import { describe, it, expect } from 'vitest'
import {
  toTitleCase,
  getCurrencySymbol,
  formatNumber,
  formatMoney,
  formatMemberSince,
  round2,
} from '@/lib/format'

describe('toTitleCase', () => {
  it('capitalizes the first letter of each word', () => {
    expect(toTitleCase('hello world')).toBe('Hello World')
  })

  it('lowercases the rest of each word', () => {
    expect(toTitleCase('HELLO WORLD')).toBe('Hello World')
    expect(toTitleCase('hELLo WoRLD')).toBe('Hello World')
  })

  it('handles single words', () => {
    expect(toTitleCase('kiosco')).toBe('Kiosco')
  })

  it('handles empty string', () => {
    expect(toTitleCase('')).toBe('')
  })
})

describe('getCurrencySymbol', () => {
  it('returns the symbol for a known currency', () => {
    expect(getCurrencySymbol('ARS')).toBe('$')
    expect(getCurrencySymbol('BRL')).toBe('R$')
    expect(getCurrencySymbol('PEN')).toBe('S/')
    expect(getCurrencySymbol('EUR')).toBe('€')
    expect(getCurrencySymbol('PYG')).toBe('₲')
  })

  it('falls back to $ for unknown currency codes', () => {
    expect(getCurrencySymbol('XYZ')).toBe('$')
    expect(getCurrencySymbol('')).toBe('$')
  })
})

describe('formatNumber', () => {
  it('formats with es-AR thousands separators (dot)', () => {
    expect(formatNumber(1234567)).toBe('1.234.567')
    expect(formatNumber(1000)).toBe('1.000')
  })

  it('leaves small numbers unchanged', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(42)).toBe('42')
  })
})

describe('formatMoney', () => {
  it('formats ARS by default with symbol and 2 decimals', () => {
    expect(formatMoney(1234.5)).toBe('$1.234,50')
    expect(formatMoney(0)).toBe('$0,00')
    expect(formatMoney(1000000)).toBe('$1.000.000,00')
  })

  it('rounds to two decimal places', () => {
    expect(formatMoney(9.999)).toBe('$10,00')
    expect(formatMoney(9.994)).toBe('$9,99')
  })

  it('uses the provided currency symbol', () => {
    expect(formatMoney(100, 'BRL')).toBe('R$100,00')
    expect(formatMoney(100, 'PEN')).toBe('S/100,00')
  })

  it('handles negative amounts', () => {
    expect(formatMoney(-50)).toBe('$-50,00')
  })
})

describe('round2', () => {
  it('collapses binary float drift to 2 decimals', () => {
    // 0.1 + 0.2 === 0.30000000000000004 sin redondear → el subtotal del POS
    // acumula este drift antes de calcular el descuento.
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })

  it('rounds a third decimal to the nearest centavo', () => {
    expect(round2(3.333)).toBe(3.33)
    expect(round2(3.336)).toBe(3.34)
  })

  it('leaves already-2dp values untouched', () => {
    expect(round2(1234.56)).toBe(1234.56)
    expect(round2(0)).toBe(0)
  })
})

describe('formatMemberSince', () => {
  it('formats an ISO date as a long es-AR date', () => {
    // Noon UTC keeps the calendar day stable under the pinned Buenos Aires tz (UTC-3).
    expect(formatMemberSince('2026-06-15T12:00:00Z')).toMatch(/15.*junio.*2026/)
  })
})
