import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import CatalogView from '@/components/catalog/CatalogView'
import type { CatalogVariantAttributeGroup } from '@/components/catalog/types'

interface CatalogPageParams {
  slug: string
}

interface BusinessRow {
  id: string
  name: string
  description: string | null
  logo_url: string | null
  whatsapp: string | null
}

interface ProductRow {
  id: string
  category_id: string | null
  name: string
  sale_price: number | string
  stock: number | string
  image_url: string | null
}

interface CategoryRow {
  id: string
  name: string
  sort_order: number
}

interface ProductSupplementRow {
  id: string
  has_variants: boolean
  brand_id: string | null
  default_variant_id: string | null
}

interface VariantFilterRow {
  typeId: string
  typeName: string
  values: { value: string; productIds: string[] }[]
}

interface CatalogPageProps {
  params: Promise<CatalogPageParams>
}

export default async function CatalogSlugPage({ params }: CatalogPageProps) {
  const { slug } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )

  // Fetch the business
  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, description, logo_url, whatsapp')
    .eq('slug', slug)
    .maybeSingle<BusinessRow>()

  if (businessError) {
    throw new Error(businessError.message)
  }

  if (!business) {
    notFound()
  }

  // Fetch products, categories, supplement data, variant filters and default
  // variant prices all in parallel.
  // NOTE: product_variants has tenant RLS — the anon client cannot query it
  // directly. get_catalog_default_variant_prices is SECURITY DEFINER + GRANT TO anon.
  const [productsResult, categoriesResult, supplementResult, variantFiltersResult, variantPricesResult] = await Promise.all([
    supabase
      .rpc('get_catalog_products', { p_slug: slug })
      .returns<ProductRow[]>(),
    supabase
      .rpc('get_catalog_categories', { p_slug: slug })
      .returns<CategoryRow[]>(),
    supabase
      .from('products')
      .select('id, has_variants, brand_id')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .eq('show_in_catalog', true)
      .returns<Omit<ProductSupplementRow, 'default_variant_id'>[]>(),
    supabase
      .rpc('get_catalog_variant_filters', { p_slug: slug }),
    supabase
      .rpc('get_catalog_default_variant_prices', { p_slug: slug })
      .returns<{ product_id: string; price: number; stock: number }[]>(),
  ])

  if (productsResult.error) throw new Error(productsResult.error.message)
  if (categoriesResult.error) throw new Error(categoriesResult.error.message)
  if (supplementResult.error) throw new Error(supplementResult.error.message)

  const products = (productsResult.data ?? []) as ProductRow[]
  const categories = (categoriesResult.data ?? []) as CategoryRow[]
  const supplementRows = (supplementResult.data ?? []) as Omit<ProductSupplementRow, 'default_variant_id'>[]

  // Build a lookup map for has_variants + brand_id
  const supplementById = new Map(supplementRows.map(r => [r.id, r]))

  // Default variant prices keyed by product_id (from SECURITY DEFINER RPC)
  const variantPriceMap = new Map<string, { price: number; stock: number }>()
  for (const v of (variantPricesResult.data ?? []) as { product_id: string; price: number; stock: number }[]) {
    variantPriceMap.set(v.product_id, { price: Number(v.price), stock: Number(v.stock) })
  }

  // Parse variant filter groups
  let variantAttributeGroups: CatalogVariantAttributeGroup[] = []
  if (!variantFiltersResult.error && variantFiltersResult.data) {
    const raw = variantFiltersResult.data as unknown
    if (Array.isArray(raw)) {
      variantAttributeGroups = (raw as VariantFilterRow[]).map(group => ({
        typeId: group.typeId,
        typeName: group.typeName,
        values: (group.values ?? []).map(v => ({
          value: v.value,
          productIds: v.productIds ?? [],
        })),
      }))
    }
  }

  return (
    <main className="h-screen overflow-y-auto bg-background px-4 py-6 md:px-6 md:py-8">
      <CatalogView
        business={{
          id: business.id,
          name: business.name,
          description: business.description,
          logoUrl: business.logo_url,
          whatsapp: business.whatsapp,
        }}
        products={products.map(product => {
          const supplement = supplementById.get(product.id)
          const defaultVariant = supplement?.has_variants
            ? variantPriceMap.get(product.id)
            : undefined
          return {
            id: product.id,
            categoryId: product.category_id,
            name: product.name,
            salePrice: defaultVariant ? defaultVariant.price : Number(product.sale_price),
            stock: defaultVariant ? defaultVariant.stock : Number(product.stock),
            imageUrl: product.image_url,
            brandId: supplement?.brand_id ?? null,
            hasVariants: supplement?.has_variants ?? false,
          }
        })}
        categories={categories.map(category => ({
          id: category.id,
          name: category.name,
        }))}
        variantAttributeGroups={variantAttributeGroups}
      />
    </main>
  )
}
