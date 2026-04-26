'use client'

import { createContext, useCallback, useContext } from 'react'
import { formatMoney } from '@/lib/format'

const CurrencyContext = createContext<string>('ARS')

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string
  children: React.ReactNode
}) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): string {
  return useContext(CurrencyContext)
}

export function useFormatMoney(): (value: number) => string {
  const currency = useCurrency()
  return useCallback((value: number) => formatMoney(value, currency), [currency])
}
