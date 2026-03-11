import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, businesses(*)')
    .single()

  const businessName = (profile?.businesses as any)?.name || 'tu negocio'

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Bienvenido 👋
      </h1>
      <p className="text-gray-500 mb-8">{businessName}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <a href="/dashboard/pos" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <div className="text-3xl mb-3">🛒</div>
          <div className="font-semibold text-gray-900 group-hover:text-blue-600">Nueva venta</div>
          <div className="text-sm text-gray-500 mt-1">Abrir terminal POS</div>
        </a>
        <a href="/dashboard/products" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <div className="text-3xl mb-3">📦</div>
          <div className="font-semibold text-gray-900 group-hover:text-blue-600">Productos</div>
          <div className="text-sm text-gray-500 mt-1">Gestionar catálogo</div>
        </a>
        <a href="/dashboard/sales" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <div className="text-3xl mb-3">📊</div>
          <div className="font-semibold text-gray-900 group-hover:text-blue-600">Ventas</div>
          <div className="text-sm text-gray-500 mt-1">Historial y reportes</div>
        </a>
        <a href="/dashboard/inventory" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <div className="text-3xl mb-3">📋</div>
          <div className="font-semibold text-gray-900 group-hover:text-gray-900">Stock</div>
          <div className="text-sm text-gray-500 mt-1">Control de inventario</div>
        </a>
      </div>
    </div>
  )
}