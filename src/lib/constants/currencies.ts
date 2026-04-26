export const CURRENCIES = [
  { code: 'ARS', label: 'Peso argentino', symbol: '$' },
  { code: 'BRL', label: 'Real brasileño', symbol: 'R$' },
  { code: 'CLP', label: 'Peso chileno', symbol: '$' },
  { code: 'COP', label: 'Peso colombiano', symbol: '$' },
  { code: 'MXN', label: 'Peso mexicano', symbol: '$' },
  { code: 'PEN', label: 'Sol peruano', symbol: 'S/' },
  { code: 'UYU', label: 'Peso uruguayo', symbol: '$' },
  { code: 'PYG', label: 'Guaraní paraguayo', symbol: '₲' },
  { code: 'BOB', label: 'Boliviano', symbol: 'Bs.' },
  { code: 'USD', label: 'Dólar estadounidense', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
] as const

export type SupportedCurrencyCode = (typeof CURRENCIES)[number]['code']
