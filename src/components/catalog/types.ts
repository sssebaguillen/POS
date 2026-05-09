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
  salePrice: number
  stock: number
  imageUrl: string | null
  brandId: string | null
  hasVariants: boolean
}

export interface CatalogCategory {
  id: string
  name: string
}

export interface CatalogCartItem {
  product: CatalogProduct
  quantity: number
  variantId: string | null
  variantLabel: string | null
}

export interface CatalogVariantOptionValue {
  id: string
  value: string
  position: number
}

export interface CatalogVariantOption {
  id: string
  attribute_type_id: string
  name: string
  position: number
  values: CatalogVariantOptionValue[]
}

export interface CatalogProductVariant {
  id: string
  price: number
  stock: number
  image_url: string | null
  is_active: boolean
  is_in_stock: boolean
  option_values: { option_id: string; option_value_id: string; value: string }[]
}

export interface CatalogProductDetail {
  id: string
  name: string
  stock: number
  image_url: string | null
  has_variants: boolean
  computed_price: number
}

export interface CatalogVariantAttributeValue {
  value: string
  productIds: string[]
}

export interface CatalogVariantAttributeGroup {
  typeId: string
  typeName: string
  values: CatalogVariantAttributeValue[]
}
