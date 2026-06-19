'use client'

import { useState } from 'react'
import { Sparkle, X } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { useChangelog } from '@/hooks/use-changelog'
import ChangelogModal from './ChangelogModal'

interface Props {
  initialLastSeenVersion: string | null
  collapsed: boolean
  isMobileDrawer: boolean
}

export default function ChangelogBanner({ initialLastSeenVersion, collapsed, isMobileDrawer }: Props) {
  const { latestRelease, unreadReleases, hiddenPatchCount, hasUnread, markAsSeen } = useChangelog(initialLastSeenVersion)
  const [open, setOpen] = useState(false)

  if (!latestRelease || !hasUnread) return null

  const compact = collapsed && !isMobileDrawer

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    markAsSeen()
  }

  function handleOpen() {
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        title={compact ? `v${latestRelease.version} · Novedades` : undefined}
        className={cn(
          'group rounded-lg border border-primary/20 bg-primary/10 text-primary transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] hover:bg-primary/15 animate-in fade-in',
          compact
            ? 'p-2.5 flex items-center justify-center w-full'
            : 'flex items-center gap-2 px-2.5 py-2 w-full text-left'
        )}
      >
        <Sparkle size={16} className="shrink-0" />
        {!compact && (
          <>
            <span className="flex-1 min-w-0 text-xs font-medium truncate">
              v{latestRelease.version} · Novedades
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Descartar novedades"
              onClick={handleDismiss}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  markAsSeen()
                }
              }}
              className="shrink-0 rounded p-0.5 text-primary/70 hover:text-primary hover:bg-primary/10 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95"
            >
              <X size={13} />
            </span>
          </>
        )}
      </button>

      <ChangelogModal
        open={open}
        onOpenChange={setOpen}
        releases={unreadReleases}
        hiddenPatchCount={hiddenPatchCount}
        onClose={markAsSeen}
      />
    </>
  )
}
