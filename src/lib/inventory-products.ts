import type { InventoryProduct } from '@/components/inventory/types'
import { unwrapRelation } from '@/lib/mappers'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

const INVENTORY_PRODUCTS_PAGE_SIZE = 1000

export const INVENTORY_PRODUCTS_SELECT =
  'id, business_id, name, price, cost, stock, min_stock, is_active, show_in_catalog, category_id, sku, barcode, brand_id, image_url, image_source, brands(id, name), categories(name, icon)'

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
  brands: InventoryBrandRelation | InventoryBrandRelation[] | null
  categories: InventoryCategoryRelation | InventoryCategoryRelation[] | null
}

function toNumber(value: number | string | null): number {
  return Number(value ?? 0)
}

export function normalizeInventoryProduct(product: InventoryProductRow): InventoryProduct {
  return {
    ...product,
    price: toNumber(product.price),
    cost: toNumber(product.cost),
    stock: toNumber(product.stock),
    min_stock: toNumber(product.min_stock),
    brand_id: product.brand_id ?? null,
    brand: unwrapRelation(product.brands),
    image_url: product.image_url ?? null,
    image_source: product.image_source ?? null,
    categories: unwrapRelation(product.categories),
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

  return {
    data: rows.map(normalizeInventoryProduct),
    error: null,
  }
}
