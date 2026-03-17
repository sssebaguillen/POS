export interface PriceList {
  id: string
  business_id: string
  name: string
  description: string | null
  multiplier: number
  is_default: boolean
  created_at: string
}

export interface PriceListOverride {
  id: string
  price_list_id: string
  product_id: string | null
  brand_id: string | null
  multiplier: number
}

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
