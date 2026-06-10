'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { X, ShoppingCart, Package, ClipboardList, BarChart2, LineChart, Settings, Sun, Moon, LogOut, PanelLeftClose, PanelLeftOpen, Receipt, UserCircle, Sparkles, Globe, ExternalLink, History, Users, Vault, Inbox, BadgePercent } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/shared/theme'
import { runThemeToggleTransition } from '@/lib/theme'
import OperatorSwitcher from '@/components/operator/OperatorSwitcher'
import CashSessionWidget from '@/components/cash-sessions/CashSessionWidget'
import OnboardingChecklist from '@/components/onboarding/OnboardingChecklist'
import ChangelogBanner from '@/components/shared/ChangelogBanner'
import FeedbackButton from '@/components/shared/FeedbackButton'
import { type Permissions, type UserRole } from '@/lib/operator'
import { resetTracking } from '@/lib/analytics'
import UnreadBadge, { useUnreadOrdersCount } from '@/components/orders/UnreadBadge'

interface NavLink {
  href: string
  label: string
  icon: React.ElementType
  check: (p: Permissions) => boolean
}

// pos_pricing is intentionally absent — it controls per-line price editing / free line in the POS, not route access.
const NAV_LINKS: NavLink[] = [
  { href: '/pos',           label: 'Vender',            icon: ShoppingCart,  check: () => true },
  { href: '/customers',     label: 'Clientes',          icon: Users,         check: () => true },
  { href: '/orders',        label: 'Pedidos online',    icon: Inbox,         check: (p) => p.online_orders === true },
  { href: '/dashboard',     label: 'Resumen',           icon: BarChart2,     check: (p) => p.reports === true },
  { href: '/stats',         label: 'Estadísticas',      icon: LineChart,     check: (p) => p.reports === true },
  { href: '/activity',      label: 'Actividad',         icon: History,       check: (p) => p.reports === true },
  { href: '/expenses',      label: 'Gastos',            icon: Receipt,       check: (p) => p.expenses === true },
  { href: '/cash-sessions', label: 'Caja',              icon: Vault,         check: (p) => p.reports === true },
  { href: '/inventory',   label: 'Inventario',        icon: Package,       check: (p) => p.inventory_read === true },
  { href: '/price-lists', label: 'Listas de precios', icon: ClipboardList, check: (p) => p.inventory_read === true },
  { href: '/promotions',  label: 'Promociones',       icon: BadgePercent,  check: (p) => p.inventory_read === true },
  { href: '/settings',    label: 'Configuración',     icon: Settings,      check: (p) => p.settings === true },
]

const NAV_SECTIONS = [
  {
    label: 'Ventas',
    hrefs: ['/pos', '/customers', '/orders'],
  },
  {
    label: 'Análisis',
    hrefs: ['/dashboard', '/stats', '/activity'],
  },
  {
    label: 'Gestión',
    hrefs: ['/inventory', '/price-lists', '/promotions'],
  },
  {
    label: 'Finanzas',
    hrefs: ['/expenses', '/cash-sessions'],
  },
]

const TOUR_ATTR_BY_HREF: Record<string, string> = {
  '/inventory': 'sidebar-inventory',
  '/expenses': 'sidebar-gastos',
  '/price-lists': 'sidebar-price-lists',
  '/pos': 'sidebar-pos',
}

interface Props {
  open: boolean
  onClose: () => void
  activeOperatorName: string | null
  activeOperatorRole: UserRole | null
  // Server-resolved from the signed operator_session cookie. null = owner / no
  // session → everything visible. Passed as a prop (not read from op_perms
  // client-side) so the first SSR render already hides restricted items —
  // otherwise they flash in before hydration hides them.
  permissions: Permissions | null
  businessId: string | null
  businessName: string
  businessSlug: string
  currencyCode: string
  collapsed: boolean
  onToggleCollapse: () => void
  showOnboardingResume?: boolean
  showChangelog?: boolean
  initialLastSeenChangelogVersion?: string | null
  // Renders header + footer only (no nav links). For shell-less entry screens
  // like /operator-select, where navigation isn't available until an operator
  // authenticates.
  minimal?: boolean
}

export default function Sidebar({
  open,
  onClose,
  activeOperatorName,
  activeOperatorRole,
  permissions,
  businessId,
  businessName,
  businessSlug,
  currencyCode,
  collapsed,
  onToggleCollapse,
  showOnboardingResume = false,
  showChangelog = false,
  initialLastSeenChangelogVersion = null,
  minimal = false,
}: Props) {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [mounted, setMounted] = useState(false)
  const [themeToggleMounted, setThemeToggleMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setThemeToggleMounted(true)
  }, [])

  const themeForUi = themeToggleMounted ? theme : 'light'

  function handleThemeToggle(e: React.MouseEvent<HTMLButtonElement>) {
    runThemeToggleTransition(e, toggle)
  }

  const isRestricted = (check: (p: Permissions) => boolean): boolean =>
    permissions !== null && !check(permissions)

  const canSeeOrders = !minimal && (permissions === null || permissions.online_orders === true)
  const { data: unreadOrdersCount = 0 } = useUnreadOrdersCount(canSeeOrders)

  const isOwnerSessionActive = activeOperatorRole === 'owner'
  const hasActiveOperatorSession =
    activeOperatorName !== null &&
    activeOperatorRole !== null
  const isOperatorSelectRoute = pathname === '/operator-select'
  const showBusinessSessionActions = isOwnerSessionActive || isOperatorSelectRoute

  async function handleLogout() {
    resetTracking()
    await supabase.auth.signOut()
    await fetch('/api/operator/logout', { method: 'POST' })
    router.push('/login')
  }

  const sidebarContent = (isMobileDrawer: boolean) => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className={cn(
          'border-b border-edge/60 flex items-center shrink-0 min-h-14',
          collapsed && !isMobileDrawer ? 'justify-center px-2' : 'justify-between px-4'
        )}
      >
        {(!collapsed || isMobileDrawer) && (
          <div className="min-w-0 py-3">
            <p className="truncate font-bold text-base text-heading font-display tracking-tight">{businessName}</p>
          </div>
        )}
        {isMobileDrawer ? (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95 ml-auto">
            <X size={18} className="text-hint" />
          </button>
        ) : (
          <button
            onClick={e => { onToggleCollapse(); e.currentTarget.blur() }}
            className={cn(
              'p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint',
              collapsed && 'mx-auto'
            )}
            title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

      {/* Nav */}
      {minimal ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-hover-bg text-hint',
              collapsed && !isMobileDrawer ? 'h-10 w-10' : 'mb-3 h-12 w-12'
            )}
          >
            <UserCircle size={collapsed && !isMobileDrawer ? 18 : 22} />
          </div>
          {(!collapsed || isMobileDrawer) && (
            <>
              <p className="text-sm font-medium text-body">Inicia tu turno</p>
              <p className="mt-1 text-xs text-hint">Selecciona un operador para comenzar.</p>
            </>
          )}
        </div>
      ) : (
      <nav className={cn('flex-1 py-3 overflow-y-auto', collapsed && !isMobileDrawer ? 'px-2' : 'px-3')}>
        {collapsed && !isMobileDrawer && showOnboardingResume && (
          <Link
            href="/dashboard"
            title="Retomar configuración inicial"
            className="flex items-center justify-center p-2.5 rounded-xl text-primary hover:bg-primary/10 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 mb-2"
          >
            <Sparkles size={18} />
          </Link>
        )}
        {NAV_SECTIONS.map(section => {
          const links = NAV_LINKS.filter(l => section.hrefs.includes(l.href) && !isRestricted(l.check))
          const showCatalog = section.label === 'Ventas' && businessSlug
          if (links.length === 0 && !showCatalog) return null
          return (
            <div key={section.label} className="mb-4">
              {(!collapsed || isMobileDrawer) && (
                <p className="text-label text-hint px-3 mb-1">{section.label}</p>
              )}
              <div className="space-y-0.5">
                {links.map(({ href, label, icon: Icon }) => {
                  const isActive = pathname === href
                  const tourTarget = TOUR_ATTR_BY_HREF[href]

                  const isOrdersLink = href === '/orders'
                  const showBadge = isOrdersLink && unreadOrdersCount > 0
                  return (
                    <Link
                      key={href}
                      href={href}
                      data-tour={tourTarget}
                      onClick={isMobileDrawer ? onClose : undefined}
                      title={collapsed && !isMobileDrawer ? label : undefined}
                      className={cn(
                        'relative flex items-center rounded-xl text-sm font-medium transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]',
                        collapsed && !isMobileDrawer
                          ? 'justify-center p-2.5 active:scale-95'
                          : 'gap-3 px-3 py-2.5',
                        isActive
                          ? 'bg-primary/10 text-[var(--primary-active-text)] font-semibold'
                          : 'text-body hover:bg-hover-bg hover:text-heading'
                      )}
                    >
                      <Icon size={18} />
                      {(!collapsed || isMobileDrawer) && label}
                      {showBadge && (
                        <UnreadBadge
                          count={unreadOrdersCount}
                          collapsed={collapsed && !isMobileDrawer}
                        />
                      )}
                    </Link>
                  )
                })}
                {showCatalog && (
                  <a
                    href={`/catalogo/${businessSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={collapsed && !isMobileDrawer ? 'Catálogo online' : undefined}
                    className={cn(
                      'flex items-center rounded-xl text-sm font-medium transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] text-body hover:bg-hover-bg hover:text-heading',
                      collapsed && !isMobileDrawer
                        ? 'justify-center p-2.5 active:scale-95'
                        : 'gap-3 px-3 py-2.5'
                    )}
                  >
                    <Globe size={18} />
                    {(!collapsed || isMobileDrawer) && (
                      <>
                        <span className="flex-1">Catálogo online</span>
                        <ExternalLink size={13} className="text-hint" />
                      </>
                    )}
                  </a>
                )}
              </div>
            </div>
          )
        })}

        {(!collapsed || isMobileDrawer) && (
          <div className="mt-1">
            <OnboardingChecklist />
          </div>
        )}
      </nav>
      )}

      {/* Footer */}
      <div
        className={cn(
          'border-t border-edge-soft flex flex-col gap-1.5',
          collapsed && !isMobileDrawer ? 'px-2 py-3 items-center' : 'px-3 py-3'
        )}
      >
        {hasActiveOperatorSession && (
          <CashSessionWidget
            canSeeAmount={permissions === null || permissions.reports === true}
            currencyCode={currencyCode}
            collapsed={collapsed}
            isMobileDrawer={isMobileDrawer}
            onNavigate={onClose}
          />
        )}

        {hasActiveOperatorSession && activeOperatorName && activeOperatorRole !== null ? (
          <OperatorSwitcher
            operatorName={activeOperatorName}
            operatorRole={activeOperatorRole}
            permissions={permissions}
            showAccountActions={showBusinessSessionActions}
            collapsed={collapsed}
            isMobileDrawer={isMobileDrawer}
            onLogout={handleLogout}
          />
        ) : (
          // Lock screen (/operator-select): no active-operator card to host these,
          // so the owner's account actions render flat.
          showBusinessSessionActions && (
            <>
              <button
                title={collapsed && !isMobileDrawer ? 'Cuenta' : undefined}
                className={cn(
                  'rounded-lg text-sm text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]',
                  collapsed && !isMobileDrawer
                    ? 'p-2.5 flex items-center justify-center w-full active:scale-95'
                    : 'flex items-center gap-2 px-3 py-2 text-left w-full'
                )}
                onClick={e => { router.push('/profile'); if (isMobileDrawer) onClose(); e.currentTarget.blur() }}
              >
                <UserCircle size={18} />
                {(!collapsed || isMobileDrawer) && 'Cuenta'}
              </button>

              <button
                type="button"
                onClick={handleLogout}
                title={collapsed && !isMobileDrawer ? 'Cerrar sesión' : undefined}
                className={cn(
                  'rounded-lg text-destructive hover:bg-destructive/10 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]',
                  collapsed && !isMobileDrawer
                    ? 'p-2.5 flex items-center justify-center w-full active:scale-95'
                    : 'flex items-center gap-2 px-3 py-2 text-left w-full text-sm'
                )}
                aria-label="Cerrar sesión"
              >
                <LogOut size={18} />
                {(!collapsed || isMobileDrawer) && 'Cerrar sesión'}
              </button>
            </>
          )
        )}

        {/* Theme toggle */}
        <button
          onClick={e => { handleThemeToggle(e); e.currentTarget.blur() }}
          title={collapsed && !isMobileDrawer
            ? (themeForUi === 'dark' ? 'Modo claro' : 'Modo oscuro')
            : undefined}
          className={cn(
            'rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] text-subtle',
            collapsed && !isMobileDrawer
              ? 'p-2.5 flex items-center justify-center w-full active:scale-95'
              : 'flex items-center gap-2 px-3 py-2 text-sm w-full'
          )}
        >
          {themeForUi === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {(!collapsed || isMobileDrawer) && (themeForUi === 'dark' ? 'Modo claro' : 'Modo oscuro')}
        </button>

        {showChangelog && mounted && (
          <ChangelogBanner
            initialLastSeenVersion={initialLastSeenChangelogVersion}
            collapsed={collapsed}
            isMobileDrawer={isMobileDrawer}
          />
        )}

        {(!collapsed || isMobileDrawer) ? (
          <div className="flex items-center justify-between px-2 pt-1">
            <span className="text-xs text-hint">© 2026 Pulsar POS</span>
            {businessId && <FeedbackButton businessId={businessId} />}
          </div>
        ) : (
          businessId && (
            <div className="flex justify-center pt-1">
              <FeedbackButton businessId={businessId} showLabel={false} />
            </div>
          )
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* ── Mobile: full-screen drawer overlay (all screen sizes when open) ── */}
      {open && (
        <div
          className="fixed inset-0 bg-black/25 z-40 transition-opacity duration-200 ease-out lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full surface-sidebar shadow-xl z-50 flex flex-col transition-transform duration-[280ms] ease-[var(--ease-drawer)] w-64 lg:hidden',
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
    </>
  )
}
