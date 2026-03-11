import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-lg text-gray-900">POS LATAM</span>
        <div className="flex items-center gap-4 text-sm">
          <a href="/dashboard/pos" className="text-gray-600 hover:text-gray-900">Vender</a>
          <a href="/dashboard/products" className="text-gray-600 hover:text-gray-900">Productos</a>
          <a href="/dashboard/sales" className="text-gray-600 hover:text-gray-900">Ventas</a>
          <a href="/dashboard/inventory" className="text-gray-600 hover:text-gray-900">Stock</a>
        </div>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}