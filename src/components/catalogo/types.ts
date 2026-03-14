export interface CatalogBusiness {
  id: string
  name: string
  description: string | null
  logoUrl: string | null
  whatsapp: string | null
}

export interface CatalogProduct {
  id: string
  categoryId: string | null
  name: string
  price: number
  stock: number
  imageUrl: string | null
}

export interface CatalogCategory {
  id: string
  name: string
}

export interface CatalogCartItem {
  product: CatalogProduct
  quantity: number
}