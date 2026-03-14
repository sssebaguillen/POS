'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import Sidebar from '@/components/sidebar'

interface SidebarContextValue {
  open: boolean
  toggle: () => void
  close: () => void
}

interface AppShellProps {
  children: React.ReactNode
  activeOperatorName: string | null
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within AppShell')
  }
  return context
}

export default function AppShell({ children, activeOperatorName }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const value = useMemo(
    () => ({
      open: sidebarOpen,
      toggle: () => setSidebarOpen(prev => !prev),
      close: () => setSidebarOpen(false),
    }),
    [sidebarOpen]
  )

  return (
    <SidebarContext.Provider value={value}>
      <div className="flex h-screen bg-background">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeOperatorName={activeOperatorName}
        />
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </SidebarContext.Provider>
  )
}
