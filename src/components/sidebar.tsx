'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, ShoppingCart, Package, ClipboardList, BarChart2, LineChart, Settings, Sun, Moon, User, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/shared/theme'
import OperatorSwitcher from '@/components/operator/OperatorSwitcher'

const links = [
  { href: '/ventas', label: 'Vender', icon: ShoppingCart },
  { href: '/dashboard', label: 'Dashboard', icon: BarChart2 },
  { href: '/stats', label: 'Estadísticas', icon: LineChart },
  { href: '/price-lists', label: 'Listas de precios', icon: Package },
  { href: '/inventory', label: 'Stock', icon: ClipboardList },
  { href: '/settings', label: 'Configuración', icon: Settings },
]

interface Props {
  open: boolean
  onClose: () => void
  activeOperatorName: string | null
}

export default function Sidebar({ open, onClose, activeOperatorName }: Props) {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-64 bg-surface shadow-xl z-50 flex flex-col transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="px-5 h-14 border-b border-edge/60 flex items-center justify-between">
          <span className="font-bold text-lg text-heading">POS LATAM</span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-hover-bg transition-colors"
          >
            <X size={18} className="text-hint" />
          </button>
        </div>

        <nav className="flex-1 py-3 px-3 space-y-0.5">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-primary text-primary-foreground'
                  : 'text-body hover:bg-hover-bg hover:text-heading'
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-edge-soft flex flex-col gap-2">
          {activeOperatorName && (
            <OperatorSwitcher operatorName={activeOperatorName} />
          )}

          <div className="flex items-center justify-between mb-1">
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-body hover:bg-hover-bg transition-colors flex-1 text-left"
              onClick={() => router.push('/settings')}
            >
              <span className="flex items-center gap-2">
                <User size={18} />
                Perfil
              </span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="p-2 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
              title="Cerrar sesion"
              aria-label="Cerrar sesion"
            >
              <LogOut size={18} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-hint px-2">© 2026 POS LATAM</span>
            <button
              onClick={toggle}
              className="p-2 rounded-lg hover:bg-hover-bg transition-colors text-subtle"
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
