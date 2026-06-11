import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import PromotionsView from '@/components/catalog/PromotionsView'
import CatalogShell from '@/components/catalog/CatalogShell'
import { mapCatalogProductRow, type CatalogProductRow } from '@/components/catalog/mapProducts'

interface BusinessRow {
  id: string
  name: string
  description: string | null
  logo_url: string | null
  whatsapp: string | null
}

interface PromotionsPageProps {
  params: Promise<{ slug: string }>
}

export default async function CatalogPromotionsPage({ params }: PromotionsPageProps) {
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

  const { data: businessRows, error: businessError } = await supabase
    .rpc('get_catalog_business', { p_slug: slug })

  if (businessError) throw new Error(businessError.message)
  const business = (businessRows as unknown as BusinessRow[] | null)?.[0]
  if (!business) notFound()

  const { data: productRows, error: productsError } = await supabase
    .rpc('get_catalog_products', { p_slug: slug })
    .returns<CatalogProductRow[]>()

  if (productsError) throw new Error(productsError.message)

  const products = ((productRows ?? []) as CatalogProductRow[])
    .map(mapCatalogProductRow)
    .filter(product => product.promo !== null)

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
      <PromotionsView slug={slug} products={products} />
    </CatalogShell>
  )
}
