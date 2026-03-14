export interface InventoryCategory {
  id: string
  name: string
  icon: string
}

export interface InventoryBrand {
  id: string
  name: string
}

export interface InventoryProduct {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  min_stock: number
  is_active: boolean
  show_in_catalog?: boolean | null
  category_id: string | null
  sku: string | null
  brand_id?: string | null
  brand?: {
    id: string
    name: string
  } | null
  barcode: string | null
  categories?: {
    name: string
    icon: string
  } | null
}