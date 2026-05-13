import type { InventoryProduct } from '@/components/inventory/types'
import { unwrapRelation } from '@/lib/mappers'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

const INVENTORY_PRODUCTS_PAGE_SIZE = 1000

export const INVENTORY_PRODUCTS_SELECT =
  'id, business_id, name, price, cost, stock, min_stock, is_active, show_in_catalog, category_id, sku, barcode, brand_id, image_url, image_source, has_variants, default_variant_id, brands(id, name), categories(name, icon)'

interface InventoryBrandRelation {
  id: string
  name: string
}

interface InventoryCategoryRelation {
  name: string
  icon: string
}

interface InventoryProductRow {
  id: string
  business_id: string
  name: string
  price: number | string | null
  cost: number | string | null
  stock: number | string | null
  min_stock: number | string | null
  is_active: boolean
  show_in_catalog: boolean | null
  category_id: string | null
  sku: string | null
  barcode: string | null
  brand_id: string | null
  image_url: string | null
  image_source: 'upload' | 'url' | null
  has_variants: boolean
  default_variant_id: string | null
  brands: InventoryBrandRelation | InventoryBrandRelation[] | null
  categories: InventoryCategoryRelation | InventoryCategoryRelation[] | null
}

interface DefaultVariantDisplayData {
  price: number
  cost: number
  stock: number
  image_url: string | null
  image_source: 'upload' | 'url' | null
}

function toNumber(value: number | string | null): number {
  return Number(value ?? 0)
}

export function normalizeInventoryProduct(
  product: InventoryProductRow,
  variantCountMap?: Map<string, number>,
  defaultVariantMap?: Map<string, DefaultVariantDisplayData>,
  variantTotalStockMap?: Map<string, number>
): InventoryProduct {
  const defaultVariant = product.has_variants && product.default_variant_id
    ? defaultVariantMap?.get(product.default_variant_id)
    : undefined

  const effectiveStock = product.has_variants
    ? (variantTotalStockMap?.get(product.id) ?? 0)
    : toNumber(product.stock)

  return {
    ...product,
    price: defaultVariant ? defaultVariant.price : toNumber(product.price),
    cost: defaultVariant ? defaultVariant.cost : toNumber(product.cost),
    stock: effectiveStock,
    min_stock: toNumber(product.min_stock),
    brand_id: product.brand_id ?? null,
    brand: unwrapRelation(product.brands),
    image_url: defaultVariant?.image_url ?? product.image_url ?? null,
    image_source: defaultVariant?.image_source ?? product.image_source ?? null,
    categories: unwrapRelation(product.categories),
    has_variants: product.has_variants ?? false,
    variant_count: variantCountMap?.get(product.id),
    default_variant_id: product.default_variant_id ?? null,
  }
}

export async function fetchInventoryProducts(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ data: InventoryProduct[] | null; error: PostgrestError | null }> {
  const rows: InventoryProductRow[] = []

  for (let from = 0; ; from += INVENTORY_PRODUCTS_PAGE_SIZE) {
    const to = from + INVENTORY_PRODUCTS_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('products')
      .select(INVENTORY_PRODUCTS_SELECT)
      .eq('business_id', businessId)
      .order('name')
      .order('id')
      .range(from, to)

    if (error) {
      return { data: null, error }
    }

    const batch = (data ?? []) as InventoryProductRow[]
    rows.push(...batch)

    if (batch.length < INVENTORY_PRODUCTS_PAGE_SIZE) {
      break
    }
  }

  // Fetch variant counts and total stock for products that have variants
  const variantProductIds = rows.filter(p => p.has_variants).map(p => p.id)
  let variantCountMap: Map<string, number> | undefined
  let variantTotalStockMap: Map<string, number> | undefined

  if (variantProductIds.length > 0) {
    const { data: variantRows } = await supabase
      .from('product_variants')
      .select('product_id, stock')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('product_id', variantProductIds)

    if (variantRows) {
      variantCountMap = new Map()
      variantTotalStockMap = new Map()
      for (const row of variantRows as { product_id: string; stock: number }[]) {
        variantCountMap.set(row.product_id, (variantCountMap.get(row.product_id) ?? 0) + 1)
        variantTotalStockMap.set(row.product_id, (variantTotalStockMap.get(row.product_id) ?? 0) + Number(row.stock))
      }
    }
  }

  // Fetch price/cost/stock from default variants for variant products
  const defaultVariantIds = rows
    .filter(p => p.has_variants && p.default_variant_id)
    .map(p => p.default_variant_id as string)

  let defaultVariantMap: Map<string, DefaultVariantDisplayData> | undefined

  if (defaultVariantIds.length > 0) {
    const { data: variantData } = await supabase
      .from('product_variants')
      .select('id, price, cost, stock, image_url, image_source')
      .in('id', defaultVariantIds)

    if (variantData) {
      defaultVariantMap = new Map()
      for (const v of variantData as {
        id: string
        price: number
        cost: number
        stock: number
        image_url: string | null
        image_source: 'upload' | 'url' | null
      }[]) {
        defaultVariantMap.set(v.id, {
          price: Number(v.price),
          cost: Number(v.cost),
          stock: Number(v.stock),
          image_url: v.image_url ?? null,
          image_source: v.image_source ?? null,
        })
      }
    }
  }

  return {
    data: rows.map(row => normalizeInventoryProduct(row, variantCountMap, defaultVariantMap, variantTotalStockMap)),
    error: null,
  }
}
