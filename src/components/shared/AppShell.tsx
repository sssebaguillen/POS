'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Sidebar from '@/components/sidebar'
import type { UserRole } from '@/lib/operator'

interface SidebarContextValue {
  open: boolean
  toggle: () => void
  close: () => void
  collapsed: boolean
  toggleCollapse: () => void
}

interface AppShellProps {
  children: React.ReactNode
  activeOperatorName: string | null
  activeOperatorRole: UserRole | null
  businessName: string
  initialCollapsed?: boolean
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within AppShell')
  }
  return context
}

const STORAGE_KEY = 'pos-sidebar-collapsed'

export default function AppShell({
  children,
  activeOperatorName,
  activeOperatorRole,
  businessName,
  initialCollapsed = false,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=31536000; SameSite=Lax`
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      open: sidebarOpen,
      toggle: () => setSidebarOpen(prev => !prev),
      close: () => setSidebarOpen(false),
      collapsed,
      toggleCollapse,
    }),
    [sidebarOpen, collapsed, toggleCollapse]
  )

  return (
    <SidebarContext.Provider value={value}>
      <div className="flex h-screen bg-background">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeOperatorName={activeOperatorName}
          activeOperatorRole={activeOperatorRole}
          businessName={businessName}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
        {/* Desktop: static offset matching sidebar width. Mobile: no offset (drawer overlay). */}
        <main
          className="flex-1 min-h-0 overflow-hidden transition-[margin] duration-200 ease-in-out lg:ml-[var(--sidebar-width)]"
          style={{
            ['--sidebar-width' as string]: collapsed ? 'var(--sidebar-collapsed-width)' : '256px',
          }}
        >
          {children}
        </main>
      </div>
    </SidebarContext.Provider>
  )
}
