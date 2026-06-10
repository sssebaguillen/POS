import { promoBadgeLabel } from '@/lib/promotions'
import type { CatalogProduct } from '@/components/catalog/types'

// Shape crudo de get_catalog_products (SECURITY DEFINER, anon)
export interface CatalogProductRow {
  id: string
  category_id: string | null
  name: string
  sale_price: number | string
  stock: number | string
  image_url: string | null
  has_variants: boolean
  brand_id: string | null
  brand_name: string | null
  variant_count: number | null
  original_price: number | string | null
  promo_kind: 'percent' | 'offer_price' | 'quantity' | null
  promo_percent: number | string | null
  promo_group_size: number | null
  promo_affected_units: number | null
  promo_pay_percent: number | string | null
  promo_ends_at: string | null
  promo_featured: boolean | null
}

export function mapCatalogProductRow(product: CatalogProductRow): CatalogProduct {
  return {
    id: product.id,
    categoryId: product.category_id,
    name: product.name,
    salePrice: Number(product.sale_price),
    stock: Number(product.stock),
    imageUrl: product.image_url,
    hasVariants: product.has_variants ?? false,
    brandId: product.brand_id ?? null,
    brandName: product.brand_name ?? null,
    variantCount: product.variant_count ?? 0,
    originalPrice: product.original_price != null ? Number(product.original_price) : null,
    promo: product.promo_kind
      ? {
          kind: product.promo_kind,
          percent: product.promo_percent != null ? Number(product.promo_percent) : null,
          group_size: product.promo_group_size,
          affected_units: product.promo_affected_units,
          pay_percent: product.promo_pay_percent != null ? Number(product.promo_pay_percent) : null,
          endsAt: product.promo_ends_at,
          featured: product.promo_featured ?? false,
          label: promoBadgeLabel({
            kind: product.promo_kind,
            percent: product.promo_percent != null ? Number(product.promo_percent) : null,
            group_size: product.promo_group_size,
            affected_units: product.promo_affected_units,
            pay_percent: product.promo_pay_percent != null ? Number(product.promo_pay_percent) : null,
          }),
        }
      : null,
  }
}
