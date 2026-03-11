'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import SidebarDrawer from '@/components/sidebar'

interface SidebarContextValue {
  open: boolean
  toggle: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  open: false,
  toggle: () => {},
  close: () => {},
})

export const useSidebar = () => useContext(SidebarContext)

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(v => !v), [])
  const close = useCallback(() => setOpen(false), [])

  return (
    <SidebarContext.Provider value={{ open, toggle, close }}>
        <div className="min-h-screen bg-app-bg">
        <SidebarDrawer open={open} onClose={close} />
        {children}
      </div>
    </SidebarContext.Provider>
  )
}
