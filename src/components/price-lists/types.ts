export type { PriceList, PriceListOverride } from '@/lib/types'

export interface PriceListProduct {
  id: string
  name: string
  cost: number
  price: number
  brand_id: string | null
  brand?: {
    id: string
    name: string
  } | null
  category_id: string | null
  categories: {
    name: string
    icon: string
  } | null
}
