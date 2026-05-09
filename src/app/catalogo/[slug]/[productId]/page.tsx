import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ProductDetailView from '@/components/catalog/ProductDetailView'
import type {
  CatalogProductDetail,
  CatalogVariantOption,
  CatalogProductVariant,
} from '@/components/catalog/types'

interface PageParams {
  slug: string
  productId: string
}

interface PageProps {
  params: Promise<PageParams>
}

interface BusinessRow {
  id: string
  name: string
}

interface RpcResult {
  success: boolean
  error?: string
  product?: CatalogProductDetail
  options?: CatalogVariantOption[]
  variants?: CatalogProductVariant[]
}

export default async function CatalogProductDetailPage({ params }: PageProps) {
  const { slug, productId } = await params

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

  const [businessResult, productResult] = await Promise.all([
    supabase
      .from('businesses')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle<BusinessRow>(),
    supabase.rpc('get_catalog_product_with_variants', {
      p_slug: slug,
      p_product_id: productId,
    }),
  ])

  if (businessResult.error) throw new Error(businessResult.error.message)
  if (!businessResult.data) notFound()

  if (productResult.error) throw new Error(productResult.error.message)

  const rpcData = productResult.data as unknown as RpcResult | null

  if (!rpcData || !rpcData.success || !rpcData.product) {
    notFound()
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 md:py-8">
      <ProductDetailView
        slug={slug}
        businessId={businessResult.data.id}
        businessName={businessResult.data.name}
        product={rpcData.product}
        options={rpcData.options ?? []}
        variants={rpcData.variants ?? []}
      />
    </main>
  )
}
