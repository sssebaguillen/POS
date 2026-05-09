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

// get_catalog_products now returns has_variants + brand_id directly
interface ProductRow {
  id: string
  category_id: string | null
  name: string
  sale_price: number | string
  stock: number | string
  image_url: string | null
  has_variants: boolean
  brand_id: string | null
  brand_name: string | null
}

interface CategoryRow {
  id: string
  name: string
  sort_order: number
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

  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, description, logo_url, whatsapp')
    .eq('slug', slug)
    .maybeSingle<BusinessRow>()

  if (businessError) throw new Error(businessError.message)
  if (!business) notFound()

  // get_catalog_products now returns has_variants + brand_id directly (SECURITY DEFINER)
  // so we don't need a separate anon query to the products table
  const [productsResult, categoriesResult, variantFiltersResult] = await Promise.all([
    supabase
      .rpc('get_catalog_products', { p_slug: slug })
      .returns<ProductRow[]>(),
    supabase
      .rpc('get_catalog_categories', { p_slug: slug })
      .returns<CategoryRow[]>(),
    supabase
      .rpc('get_catalog_variant_filters', { p_slug: slug }),
  ])

  if (productsResult.error) throw new Error(productsResult.error.message)
  if (categoriesResult.error) throw new Error(categoriesResult.error.message)

  const products = (productsResult.data ?? []) as ProductRow[]
  const categories = (categoriesResult.data ?? []) as CategoryRow[]

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
        slug={slug}
        business={{
          id: business.id,
          name: business.name,
          description: business.description,
          logoUrl: business.logo_url,
          whatsapp: business.whatsapp,
        }}
        products={products.map(product => ({
          id: product.id,
          categoryId: product.category_id,
          name: product.name,
          salePrice: Number(product.sale_price),
          stock: Number(product.stock),
          imageUrl: product.image_url,
          hasVariants: product.has_variants ?? false,
          brandId: product.brand_id ?? null,
          brandName: product.brand_name ?? null,
        }))}
        categories={categories.map(category => ({
          id: category.id,
          name: category.name,
        }))}
        variantAttributeGroups={variantAttributeGroups}
      />
    </main>
  )
}
