import { CURRENCIES } from '@/lib/constants/currencies'

export function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export function getCurrencySymbol(code: string): string {
  return CURRENCIES.find(c => c.code === code)?.symbol ?? '$'
}

export function formatMoney(value: number, currencyCode?: string): string {
  const symbol = getCurrencySymbol(currencyCode ?? 'ARS')
  return `${symbol}${value.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
