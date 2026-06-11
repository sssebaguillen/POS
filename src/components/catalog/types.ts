export interface CatalogBusiness {
  id: string
  name: string
  description: string | null
  logoUrl: string | null
  whatsapp: string | null
}

// Promo vigente del producto, ya resuelta server-side por las RPCs del catálogo.
// salePrice YA viene con la promo unitaria aplicada; originalPrice trae el precio
// previo (para tachado). Las promos de cantidad no tocan el unitario — el descuento
// se calcula por línea en el carrito con computeQuantityDiscount.
export interface CatalogPromo {
  kind: 'percent' | 'offer_price' | 'quantity'
  percent: number | null
  group_size: number | null
  affected_units: number | null
  pay_percent: number | null
  endsAt: string | null
  featured: boolean
  label: string
}

export interface CatalogProduct {
  id: string
  categoryId: string | null
  name: string
  salePrice: number
  stock: number
  imageUrl: string | null
  brandId: string | null
  brandName: string | null
  hasVariants: boolean
  variantCount: number
  originalPrice: number | null
  promo: CatalogPromo | null
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
  variantImageUrl: string | null
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
  original_price?: number | null
  stock: number
  image_url: string | null
  is_active: boolean
  is_in_stock: boolean
  option_values: { option_id: string; option_value_id: string; value: string }[]
}

export interface CatalogDetailPromo {
  kind: 'percent' | 'offer_price' | 'quantity'
  percent: number | null
  group_size: number | null
  affected_units: number | null
  pay_percent: number | null
  ends_at: string | null
  featured: boolean
}

export interface CatalogProductDetail {
  id: string
  name: string
  stock: number
  image_url: string | null
  has_variants: boolean
  computed_price: number
  original_price?: number | null
  brand_name?: string | null
  category_name?: string | null
  promo?: CatalogDetailPromo | null
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
