'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ShoppingCart, Package, BarChart2, ClipboardList, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/', label: 'Vender', icon: ShoppingCart },
  { href: '/products', label: 'Productos', icon: Package },
  { href: '/sales', label: 'Ventas', icon: BarChart2 },
  { href: '/inventory', label: 'Stock', icon: ClipboardList },
  { href: '/settings', label: 'Configuración', icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 min-h-screen bg-white border-r flex flex-col shrink-0">
      <div className="px-6 py-5 border-b">
        <span className="font-bold text-lg text-gray-900">POS LATAM</span>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
