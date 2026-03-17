'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, ShoppingCart, Package, ClipboardList, BarChart2, LineChart, Settings, Sun, Moon, User, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo } from 'react'
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
  { href: '/pos',         label: 'Vender',            icon: ShoppingCart, check: () => true },
  { href: '/dashboard',   label: 'Dashboard',         icon: BarChart2,    check: (p) => p.stats === true },
  { href: '/stats',       label: 'Estadísticas',      icon: LineChart,    check: (p) => p.stats === true },
  { href: '/price-lists', label: 'Listas de precios', icon: Package,      check: (p) => p.price_lists === true },
  { href: '/inventory',   label: 'Stock',             icon: ClipboardList,check: (p) => p.stock === true },
  { href: '/settings',    label: 'Configuración',     icon: Settings,     check: (p) => p.settings === true },
]

const NAV_SECTIONS = [
  {
    label: 'Principal',
    hrefs: ['/pos', '/dashboard', '/stats'],
  },
  {
    label: 'Gestión',
    hrefs: ['/price-lists', '/inventory'],
  },
  {
    label: 'Sistema',
    hrefs: ['/settings'],
  },
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
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function Sidebar({ open, onClose, activeOperatorName, collapsed, onToggleCollapse }: Props) {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
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

  const sidebarContent = (isMobileDrawer: boolean) => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className={cn(
          'h-14 border-b border-edge/60 flex items-center shrink-0',
          collapsed && !isMobileDrawer ? 'justify-center px-2' : 'justify-between px-4'
        )}
      >
        {(!collapsed || isMobileDrawer) && (
          <span className="font-bold text-base text-heading tracking-tight">Pulsar POS</span>
        )}
        {isMobileDrawer ? (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors ml-auto">
            <X size={18} className="text-hint" />
          </button>
        ) : (
          <button
            onClick={onToggleCollapse}
            className={cn(
              'p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint',
              collapsed && 'mx-auto'
            )}
            title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-3 overflow-y-auto', collapsed && !isMobileDrawer ? 'px-2' : 'px-3')}>
        {NAV_SECTIONS.map(section => {
          const links = NAV_LINKS.filter(l => section.hrefs.includes(l.href))
          return (
            <div key={section.label} className="mb-4">
              {(!collapsed || isMobileDrawer) && (
                <p className="text-label text-hint px-3 mb-1">{section.label}</p>
              )}
              <div className="space-y-0.5">
                {links.map(({ href, label, icon: Icon, check }) => {
                  const restricted = isRestricted(check)
                  const isActive = pathname === href

                  if (restricted) {
                    return (
                      <span
                        key={href}
                        role="button"
                        onClick={() => { handleRestrictedClick(label); }}
                        title={collapsed && !isMobileDrawer ? label : undefined}
                        className={cn(
                          'flex items-center rounded-lg text-sm font-medium opacity-50 cursor-not-allowed select-none text-body',
                          collapsed && !isMobileDrawer
                            ? 'justify-center p-2.5'
                            : 'gap-3 px-3 py-2.5'
                        )}
                      >
                        <Icon size={18} />
                        {(!collapsed || isMobileDrawer) && label}
                      </span>
                    )
                  }

                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={isMobileDrawer ? onClose : undefined}
                      title={collapsed && !isMobileDrawer ? label : undefined}
                      className={cn(
                        'flex items-center rounded-xl text-sm font-medium transition-colors',
                        collapsed && !isMobileDrawer
                          ? 'justify-center p-2.5'
                          : 'gap-3 px-3 py-2.5',
                        isActive
                          ? 'bg-primary/10 text-[var(--primary-active-text)] font-semibold'
                          : 'text-body hover:bg-hover-bg hover:text-heading'
                      )}
                    >
                      <Icon size={18} />
                      {(!collapsed || isMobileDrawer) && label}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          'border-t border-edge-soft flex flex-col gap-1.5',
          collapsed && !isMobileDrawer ? 'px-2 py-3 items-center' : 'px-3 py-3'
        )}
      >
        {activeOperatorName && (!collapsed || isMobileDrawer) && (
          <OperatorSwitcher operatorName={activeOperatorName} />
        )}

        {/* Profile */}
        <button
          title={collapsed && !isMobileDrawer ? 'Perfil' : undefined}
          className={cn(
            'rounded-lg text-sm text-body hover:bg-hover-bg transition-colors',
            collapsed && !isMobileDrawer
              ? 'p-2.5 flex items-center justify-center w-full'
              : 'flex items-center gap-2 px-3 py-2 text-left w-full'
          )}
          onClick={() => { router.push('/settings'); if (isMobileDrawer) onClose() }}
        >
          <User size={18} />
          {(!collapsed || isMobileDrawer) && 'Perfil'}
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed && !isMobileDrawer ? 'Cerrar sesion' : undefined}
          className={cn(
            'rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors',
            collapsed && !isMobileDrawer
              ? 'p-2.5 flex items-center justify-center w-full'
              : 'flex items-center gap-2 px-3 py-2 text-left w-full text-sm'
          )}
          aria-label="Cerrar sesion"
        >
          <LogOut size={18} />
          {(!collapsed || isMobileDrawer) && 'Cerrar sesion'}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={collapsed && !isMobileDrawer
            ? (theme === 'dark' ? 'Modo claro' : 'Modo oscuro')
            : undefined}
          className={cn(
            'rounded-lg hover:bg-hover-bg transition-colors text-subtle',
            collapsed && !isMobileDrawer
              ? 'p-2.5 flex items-center justify-center w-full'
              : 'flex items-center gap-2 px-3 py-2 text-sm w-full'
          )}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {(!collapsed || isMobileDrawer) && (theme === 'dark' ? 'Modo claro' : 'Modo oscuro')}
        </button>

        {(!collapsed || isMobileDrawer) && (
          <span className="text-xs text-hint px-2 pt-1">© 2026 Pulsar POS</span>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* ── Mobile: full-screen drawer overlay (all screen sizes when open) ── */}
      {open && (
        <div
          className="fixed inset-0 bg-black/25 z-40 transition-opacity lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full surface-sidebar shadow-xl z-50 flex flex-col transition-transform duration-200 ease-in-out w-64 lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent(true)}
      </aside>

      {/* ── Desktop: always-visible, collapsible ── */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed top-0 left-0 h-full surface-sidebar z-30 transition-[width] duration-200 ease-in-out overflow-hidden',
          collapsed ? 'w-[72px]' : 'w-64'
        )}
      >
        {sidebarContent(false)}
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
