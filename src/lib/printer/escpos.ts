import { normalizePayment } from '@/lib/payments'
import { formatMoney } from '@/lib/format'
import type { ReceiptData } from '@/lib/printer/types'

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  writable?: WritableStream<Uint8Array>
}

type SerialNavigator = Navigator & {
  serial?: {
    getPorts?: () => Promise<SerialPortLike[]>
    requestPort: () => Promise<SerialPortLike>
  }
}

const DEFAULT_COLUMNS = 42

function sanitizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '')
}

function padRight(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ')
}

function padLeft(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padStart(width, ' ')
}

function wrapText(value: string, width: number) {
  const words = sanitizeText(value).split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }

    const next = `${current} ${word}`
    if (next.length <= width) {
      current = next
      continue
    }

    lines.push(current)
    current = word
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

function buildReceiptBuffer(receipt: ReceiptData) {
  const encoder = new TextEncoder()
  const bytes: number[] = []

  function push(...values: number[]) {
    bytes.push(...values)
  }

  function pushText(value = '') {
    push(...encoder.encode(sanitizeText(value)))
  }

  function lineBreak(times = 1) {
    for (let i = 0; i < times; i += 1) {
      push(0x0a)
    }
  }

  function align(mode: 0 | 1 | 2) {
    push(0x1b, 0x61, mode)
  }

  function bold(enabled: boolean) {
    push(0x1b, 0x45, enabled ? 1 : 0)
  }

  function textSize(width: 1 | 2, height: 1 | 2) {
    push(0x1d, 0x21, ((width - 1) << 4) | (height - 1))
  }

  function separator() {
    pushText('-'.repeat(DEFAULT_COLUMNS))
    lineBreak()
  }

  push(0x1b, 0x40)
  align(1)
  bold(true)
  textSize(1, 2)
  pushText(receipt.businessName)
  lineBreak()
  textSize(1, 1)
  bold(false)
  pushText('Comprobante de venta')
  lineBreak()
  pushText(new Date(receipt.createdAt).toLocaleString('es-AR'))
  lineBreak()
  pushText(`Venta #${receipt.saleId.slice(0, 8).toUpperCase()}`)
  lineBreak()
  separator()

  const amountColumnWidth = 12
  const detailColumnWidth = DEFAULT_COLUMNS - amountColumnWidth

  align(0)
  for (const item of receipt.items) {
    const titleLines = wrapText(`${item.quantity}x ${item.name}`, detailColumnWidth)
    titleLines.forEach((line, index) => {
      const amount =
        index === 0
          ? padLeft(formatMoney(item.total, receipt.currency ?? 'ARS'), amountColumnWidth)
          : ' '.repeat(amountColumnWidth)
      pushText(`${padRight(line, detailColumnWidth)}${amount}`)
      lineBreak()
    })

    pushText(padRight(`   ${formatMoney(item.unit_price, receipt.currency ?? 'ARS')} c/u`, DEFAULT_COLUMNS))
    lineBreak()
  }

  separator()
  pushText(
    `${padRight('Subtotal', detailColumnWidth)}${padLeft(formatMoney(receipt.subtotal, receipt.currency ?? 'ARS'), amountColumnWidth)}`
  )
  lineBreak()
  if (receipt.discount > 0) {
    pushText(
      `${padRight('Descuento', detailColumnWidth)}${padLeft(`-${formatMoney(receipt.discount, receipt.currency ?? 'ARS')}`, amountColumnWidth)}`
    )
    lineBreak()
  }

  bold(true)
  pushText(
    `${padRight('TOTAL', detailColumnWidth)}${padLeft(formatMoney(receipt.total, receipt.currency ?? 'ARS'), amountColumnWidth)}`
  )
  lineBreak()
  bold(false)
  separator()

  pushText(`Pago: ${normalizePayment(receipt.paymentMethod)}`)
  lineBreak()
  if (receipt.paymentMethod === 'cash' && receipt.cashReceived !== null) {
    pushText(`Recibido: ${formatMoney(receipt.cashReceived, receipt.currency ?? 'ARS')}`)
    lineBreak()
    pushText(`Vuelto: ${formatMoney(receipt.change, receipt.currency ?? 'ARS')}`)
    lineBreak()
  }

  separator()
  align(1)
  pushText('Gracias por tu compra')
  lineBreak(4)
  push(0x1d, 0x56, 0x41, 0x10)

  return new Uint8Array(bytes)
}

function getSerialApi() {
  if (typeof navigator === 'undefined') return null
  return (navigator as SerialNavigator).serial ?? null
}

export function supportsWebSerial() {
  return Boolean(getSerialApi()?.requestPort)
}

async function getOrRequestPort() {
  const serial = getSerialApi()
  if (!serial) {
    throw new Error('La impresión directa requiere un navegador compatible con Web Serial.')
  }

  const knownPorts = await serial.getPorts?.()
  if (knownPorts && knownPorts.length > 0) {
    return knownPorts[0]
  }

  return serial.requestPort()
}

export async function printReceiptEscPos(receipt: ReceiptData) {
  const port = await getOrRequestPort()
  await port.open({ baudRate: 9600 })

  const writer = port.writable?.getWriter()
  if (!writer) {
    await port.close().catch(() => {})
    throw new Error('La impresora no expuso un canal de escritura serial utilizable.')
  }

  try {
    await writer.write(buildReceiptBuffer(receipt))
  } finally {
    writer.releaseLock()
    await port.close().catch(() => {})
  }
}
