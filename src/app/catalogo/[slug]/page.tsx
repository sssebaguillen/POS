import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import CatalogView from '@/components/catalog/CatalogView'

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
  price: number | string
  stock: number | string
  image_url: string | null
}

interface CategoryRow {
  id: string
  name: string
  sort_order: number
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

  // Obtener el negocio
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

  // === RPCs con tipado seguro ===
  const [productsResult, categoriesResult] = await Promise.all([
    supabase
      .rpc('get_catalog_products', { p_slug: slug })
      .returns<ProductRow[]>(),
    supabase
      .rpc('get_catalog_categories', { p_slug: slug })
      .returns<CategoryRow[]>(),
  ])

  if (productsResult.error) {
    throw new Error(productsResult.error.message)
  }
  if (categoriesResult.error) {
    throw new Error(categoriesResult.error.message)
  }

  // Casteo explícito para que TypeScript esté feliz
  const products = (productsResult.data ?? []) as ProductRow[]
  const categories = (categoriesResult.data ?? []) as CategoryRow[]

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
        products={products.map(product => ({
          id: product.id,
          categoryId: product.category_id,
          name: product.name,
          price: Number(product.price),
          stock: Number(product.stock),
          imageUrl: product.image_url,
        }))}
        categories={categories.map(category => ({
          id: category.id,
          name: category.name,
        }))}
      />
    </main>
  )
}