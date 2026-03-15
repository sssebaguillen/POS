'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, ShoppingCart, Package, ClipboardList, BarChart2, LineChart, Settings, Sun, Moon, User, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/shared/theme'
import OperatorSwitcher from '@/components/operator/OperatorSwitcher'
import type { Permissions } from '@/lib/operator'

interface NavLink {
  href: string
  label: string
  icon: React.ElementType
  check: (p: Permissions) => boolean
}

const NAV_LINKS: NavLink[] = [
  { href: '/ventas',      label: 'Vender',            icon: ShoppingCart, check: () => true },
  { href: '/dashboard',   label: 'Dashboard',         icon: BarChart2,    check: (p) => p.stats === true },
  { href: '/stats',       label: 'Estadísticas',      icon: LineChart,    check: (p) => p.stats === true },
  { href: '/price-lists', label: 'Listas de precios', icon: Package,      check: (p) => p.price_lists === true },
  { href: '/inventory',   label: 'Stock',             icon: ClipboardList,check: (p) => p.stock === true },
  { href: '/settings',    label: 'Configuración',     icon: Settings,     check: (p) => p.settings === true },
]

function parseOpPerms(raw: string): Permissions | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    return {
      sales:              typeof p.sales === 'boolean'              ? p.sales              : false,
      stock:              typeof p.stock === 'boolean'              ? p.stock              : false,
      stock_write:        typeof p.stock_write === 'boolean'        ? p.stock_write        : false,
      stats:              typeof p.stats === 'boolean'              ? p.stats              : false,
      price_lists:        typeof p.price_lists === 'boolean'        ? p.price_lists        : false,
      price_lists_write:  typeof p.price_lists_write === 'boolean'  ? p.price_lists_write  : false,
      settings:           typeof p.settings === 'boolean'           ? p.settings           : false,
    }
  } catch {
    return null
  }
}

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
  // null = no cookie present (owner browsing) → never restrict
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;)\s*op_perms=([^;]+)/)
    if (match) {
      setPermissions(parseOpPerms(match[1]))
    } else {
      setPermissions(null)
    }
  }, [pathname])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // Only restrict when an operator cookie is present AND the check fails.
  // When permissions is null (owner without operator session), never restrict.
  const isRestricted = (check: (p: Permissions) => boolean): boolean =>
    permissions !== null && !check(permissions)

  function handleRestrictedClick(label: string) {
    setToast(`No tenés permisos para acceder a ${label}`)
    onClose()
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/25 z-40 transition-opacity"
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
          {NAV_LINKS.map(({ href, label, icon: Icon, check }) => {
            if (isRestricted(check)) {
              return (
                <span
                  key={href}
                  role="button"
                  onClick={() => handleRestrictedClick(label)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium opacity-50 cursor-not-allowed select-none text-body"
                >
                  <Icon size={18} />
                  {label}
                </span>
              )
            }
            return (
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
            )
          })}
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

      {toast && (
        <div
          role="alert"
          className="fixed bottom-4 left-4 z-[60] rounded-lg border border-amber-200 bg-white px-4 py-2.5 shadow-lg text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/80 dark:text-amber-200"
        >
          {toast}
        </div>
      )}
    </>
  )
}
