import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ProductDetailView from '@/components/catalog/ProductDetailView'
import CatalogShell from '@/components/catalog/CatalogShell'
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
  description: string | null
  logo_url: string | null
  whatsapp: string | null
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
    supabase.rpc('get_catalog_business', { p_slug: slug }),
    supabase.rpc('get_catalog_product_with_variants', {
      p_slug: slug,
      p_product_id: productId,
    }),
  ])

  if (businessResult.error) throw new Error(businessResult.error.message)
  const business = (businessResult.data as unknown as BusinessRow[] | null)?.[0]
  if (!business) notFound()

  if (productResult.error) throw new Error(productResult.error.message)

  const rpcData = productResult.data as unknown as RpcResult | null

  if (!rpcData || !rpcData.success || !rpcData.product) {
    notFound()
  }

  return (
    <CatalogShell
      slug={slug}
      business={{
        id: business.id,
        name: business.name,
        description: business.description,
        logoUrl: business.logo_url,
        whatsapp: business.whatsapp,
      }}
    >
      <ProductDetailView
        slug={slug}
        product={rpcData.product}
        options={rpcData.options ?? []}
        variants={rpcData.variants ?? []}
      />
    </CatalogShell>
  )
}
