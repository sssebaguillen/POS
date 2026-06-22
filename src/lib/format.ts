import { CURRENCIES } from '@/lib/constants/currencies'

export function toTitleCase(str: string): string {
  // Capitaliza la primera letra de cada palabra (tras inicio de string o un
  // separador que no sea letra/número). Unicode-aware vía \p{L}: la `ñ` y las
  // vocales acentuadas cuentan como letras, así "piña" → "Piña" (no "PiñA") y
  // "sábanas" → "Sábanas" (no "SáBanas"). El antiguo /\b\w/ trataba `\w` como
  // [A-Za-z0-9_], dejando ñ/tildes como límite de palabra y rompiendo el casing.
  return str
    .toLowerCase()
    .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
}

export function getCurrencySymbol(code: string): string {
  return CURRENCIES.find(c => c.code === code)?.symbol ?? '$'
}

export function formatNumber(value: number): string {
  return value.toLocaleString('es-AR')
}

// Redondeo a 2 decimales para CÁLCULO de montos (no formato). Único punto de
// verdad del patrón Math.round(v*100)/100 en el camino del dinero.
export const round2 = (v: number): number => Math.round(v * 100) / 100

export function formatMemberSince(value: string): string {
  return new Date(value).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function formatMoney(value: number, currencyCode?: string): string {
  const symbol = getCurrencySymbol(currencyCode ?? 'ARS')
  return `${symbol}${value.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
