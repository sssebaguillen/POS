import { describe, it, expect, vi, afterEach } from 'vitest'
import { supportsWebSerial, printReceiptEscPos } from '@/lib/printer/escpos'
import type { ReceiptData } from '@/lib/printer/types'

function makeReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    saleId: 'abcdef1234',
    businessName: 'Mi Negocio',
    createdAt: '2026-06-15T12:00:00Z',
    items: [
      {
        product_id: 'p-1',
        variant_id: null,
        name: 'Café con leche',
        icon: null,
        quantity: 2,
        unit_price: 100,
        total: 200,
        unit_price_override: null,
        override_reason: null,
        free_line_description: null,
        variant_label: null,
        promotion_id: null,
        promo_discount: 0,
        promo_label: null,
      },
    ],
    subtotal: 200,
    discount: 0,
    total: 200,
    paymentMethod: 'cash',
    cashReceived: null,
    change: 0,
    currency: 'ARS',
    ...overrides,
  }
}

// A fake Web Serial port that captures everything written to it.
function makeFakeSerial() {
  const written: number[] = []
  const writer = {
    write: vi.fn((bytes: Uint8Array) => {
      written.push(...bytes)
      return Promise.resolve()
    }),
    releaseLock: vi.fn(),
  }
  const port = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    writable: { getWriter: () => writer },
  }
  const serial = {
    getPorts: vi.fn().mockResolvedValue([port]),
    requestPort: vi.fn().mockResolvedValue(port),
  }
  return { serial, port, writer, written }
}

function asText(bytes: number[]): string {
  return Buffer.from(bytes).toString('latin1')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsWebSerial', () => {
  it('returns false when navigator has no serial API', () => {
    vi.stubGlobal('navigator', {})
    expect(supportsWebSerial()).toBe(false)
  })

  it('returns true when navigator.serial.requestPort exists', () => {
    vi.stubGlobal('navigator', { serial: { requestPort: () => {} } })
    expect(supportsWebSerial()).toBe(true)
  })
})

describe('printReceiptEscPos', () => {
  it('opens the port at 9600 baud and writes a buffer', async () => {
    const { serial, port, writer } = makeFakeSerial()
    vi.stubGlobal('navigator', { serial })

    await printReceiptEscPos(makeReceipt())

    expect(port.open).toHaveBeenCalledWith({ baudRate: 9600 })
    expect(writer.write).toHaveBeenCalledOnce()
    expect(writer.releaseLock).toHaveBeenCalled()
    expect(port.close).toHaveBeenCalled()
  })

  it('emits the ESC/POS init command at the start and a cut command at the end', async () => {
    const { serial, written } = makeFakeSerial()
    vi.stubGlobal('navigator', { serial })

    await printReceiptEscPos(makeReceipt())

    // ESC @ (initialize)
    expect(written.slice(0, 2)).toEqual([0x1b, 0x40])
    // GS V A 0x10 (partial cut) at the very end
    expect(written.slice(-4)).toEqual([0x1d, 0x56, 0x41, 0x10])
  })

  it('strips accents/non-ASCII from text (sanitizeText)', async () => {
    const { serial, written } = makeFakeSerial()
    vi.stubGlobal('navigator', { serial })

    await printReceiptEscPos(makeReceipt())
    const text = asText(written)

    expect(text).toContain('Mi Negocio')
    expect(text).toContain('Cafe con leche') // "Café" → "Cafe"
    expect(text).not.toContain('Café')
    expect(text).toContain('TOTAL')
    expect(text).toContain('Gracias por tu compra')
  })

  it('includes the discount line only when discount > 0', async () => {
    const noDiscount = makeFakeSerial()
    vi.stubGlobal('navigator', { serial: noDiscount.serial })
    await printReceiptEscPos(makeReceipt({ discount: 0 }))
    expect(asText(noDiscount.written)).not.toContain('Descuento')

    vi.unstubAllGlobals()

    const withDiscount = makeFakeSerial()
    vi.stubGlobal('navigator', { serial: withDiscount.serial })
    await printReceiptEscPos(makeReceipt({ discount: 50, total: 150 }))
    expect(asText(withDiscount.written)).toContain('Descuento')
  })

  it('prints Recibido/Vuelto lines for cash payments with cashReceived', async () => {
    const { serial, written } = makeFakeSerial()
    vi.stubGlobal('navigator', { serial })

    await printReceiptEscPos(makeReceipt({ paymentMethod: 'cash', cashReceived: 500, change: 300 }))
    const text = asText(written)
    expect(text).toContain('Recibido')
    expect(text).toContain('Vuelto')
  })

  it('throws a friendly error when Web Serial is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    await expect(printReceiptEscPos(makeReceipt())).rejects.toThrow(/Web Serial/)
  })
})
