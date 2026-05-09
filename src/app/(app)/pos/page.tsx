export const runtime = 'edge'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import type { PriceListOverride } from '@/lib/types'
import POSView from '@/components/pos/POSView'
import { requireAuthenticatedBusinessId } from '@/lib/business'
import { normalizePriceList, normalizePriceListOverride, unwrapRelation } from '@/lib/mappers'

export default async function POSPage() {
  const supabase = await createClient()
  const businessId = await requireAuthenticatedBusinessId(supabase)

  const cookieStore = await cookies()
  const activeOperator = getActiveOperator(cookieStore)

  const [
    { data: business, error: businessError },
    { data: products, error: productsError },
    { data: priceLists, error: priceListsError },
  ] = await Promise.all([
    supabase
      .from('businesses')
      .select('id, name, settings')
      .eq('id', businessId)
      .single(),
    supabase
      .from('products')
      .select('id, business_id, name, price, cost, stock, min_stock, is_active, show_in_catalog, category_id, sku, barcode, brand_id, image_url, image_source, sales_count, has_variants, default_variant_id, created_at, brands(id, name), categories(name, icon)')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('sales_count', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('price_lists')
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .eq('business_id', businessId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true }),
  ])

  if (businessError) {
    throw new Error(businessError.message)
  }

  if (productsError) {
    throw new Error(productsError.message)
  }

  if (priceListsError) {
    throw new Error(priceListsError.message)
  }

  // Fetch default variant data for variant products
  type ProductWithVariant = { has_variants?: boolean; default_variant_id?: string | null }
  const defaultVariantIds = (products ?? [])
    .filter(p => (p as typeof p & ProductWithVariant).has_variants && (p as typeof p & ProductWithVariant).default_variant_id)
    .map(p => (p as typeof p & ProductWithVariant).default_variant_id as string)

  const posDefaultVariantMap = new Map<string, { price: number; stock: number }>()
  if (defaultVariantIds.length > 0) {
    const { data: dvData } = await supabase
      .from('product_variants')
      .select('id, price, stock')
      .in('id', defaultVariantIds)
    if (dvData) {
      for (const v of dvData as { id: string; price: number; stock: number }[]) {
        posDefaultVariantMap.set(v.id, { price: Number(v.price), stock: Number(v.stock) })
      }
    }
  }

  const priceListIds = (priceLists ?? []).map(pl => pl.id)
  let priceListOverrides: PriceListOverride[] = []
  if (priceListIds.length > 0) {
    const { data: overridesData, error: overridesError } = await supabase
      .from('price_list_overrides')
      .select('id, price_list_id, product_id, brand_id, multiplier')
      .in('price_list_id', priceListIds)
    if (overridesError) {
      throw new Error(overridesError.message)
    }
    priceListOverrides = (overridesData ?? []).map(normalizePriceListOverride)
  }

  return (
    <POSView
      products={(products ?? []).map(product => {
        const typedProduct = product as typeof product & { has_variants?: boolean; default_variant_id?: string | null }
        const defaultVariant = typedProduct.has_variants && typedProduct.default_variant_id
          ? posDefaultVariantMap.get(typedProduct.default_variant_id)
          : undefined
        return {
          ...product,
          price: defaultVariant ? defaultVariant.price : Number(product.price),
          cost: Number(product.cost),
          stock: defaultVariant ? defaultVariant.stock : Number(product.stock),
          min_stock: Number(product.min_stock),
          sales_count: Number(product.sales_count),
          has_variants: typedProduct.has_variants ?? false,
          brand_id: product.brand_id ?? null,
          brand: unwrapRelation(product.brands),
          image_url: product.image_url ?? null,
          image_source: product.image_source ?? null,
          categories: unwrapRelation(product.categories),
        }
      })}
      businessId={businessId}
      businessName={business?.name ?? 'Negocio'}
      freeLineEnabled={(business?.settings as Record<string, unknown> | null)?.free_line_enabled === true}
      priceLists={(priceLists ?? []).map(normalizePriceList)}
      priceListOverrides={priceListOverrides}
      activeOperator={activeOperator}
    />
  )
}
