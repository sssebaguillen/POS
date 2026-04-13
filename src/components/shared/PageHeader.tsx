'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { Menu, ChevronRight } from 'lucide-react'
import { useSidebar } from '@/components/shared/AppShell'

interface Breadcrumb {
  label: string
  href: string
}

interface Props {
  title: string
  breadcrumbs?: Breadcrumb[]
  children?: React.ReactNode
}

export default function PageHeader({ title, breadcrumbs, children }: Props) {
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
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="flex items-center gap-1 text-sm text-muted-foreground font-display font-bold" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight size={14} className="shrink-0" />}
              <Link href={crumb.href} className="hover:text-heading transition-colors">
                {crumb.label}
              </Link>
            </Fragment>
          ))}
          <ChevronRight size={14} className="shrink-0" />
          <span className="font-bold text-heading font-display">{title}</span>
        </nav>
      ) : (
        <h1 className="text-lg font-bold text-heading font-display">{title}</h1>
      )}
      {children && (
        <div className="flex-1 flex items-center justify-end gap-3">
          {children}
        </div>
      )}
    </header>
  )
}
