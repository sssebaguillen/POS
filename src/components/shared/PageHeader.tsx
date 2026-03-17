'use client'

import { Menu } from 'lucide-react'
import { useSidebar } from '@/components/shared/AppShell'

interface Props {
  title: string
  children?: React.ReactNode
}

export default function PageHeader({ title, children }: Props) {
  const { toggle } = useSidebar()

  return (
    <header className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 gap-4 shrink-0">
      {/* Mobile: opens the drawer overlay */}
      <button
        onClick={toggle}
        className="p-1.5 -ml-1 rounded-lg hover:bg-hover-bg transition-colors lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu size={20} className="text-body" />
      </button>
      <h1 className="text-lg font-bold text-heading">{title}</h1>
      {children && (
        <div className="flex-1 flex items-center justify-end gap-3">
          {children}
        </div>
      )}
    </header>
  )
}
