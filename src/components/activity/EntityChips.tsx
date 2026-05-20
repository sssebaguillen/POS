'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ENTITY_OVERFLOW_OPTIONS, ENTITY_PRIMARY_OPTIONS } from '@/components/activity/config'
import type { ActivityEntityFilter } from '@/components/activity/types'

interface EntityChipsProps {
  value: ActivityEntityFilter
  onChange: (value: ActivityEntityFilter) => void
}

export default function EntityChips({ value, onChange }: EntityChipsProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onDocumentClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onEscape)

    return () => {
      document.removeEventListener('mousedown', onDocumentClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const overflowActive = ENTITY_OVERFLOW_OPTIONS.find(option => option.value === value)
  const moreLabel = overflowActive?.label ?? 'Más'
  const moreActive = Boolean(overflowActive)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ENTITY_PRIMARY_OPTIONS.map(option => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'pill-tab',
              active && 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30',
            )}
          >
            {option.label}
          </button>
        )
      })}

      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'pill-tab inline-flex items-center gap-1',
            moreActive && 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30',
          )}
        >
          {moreLabel}
          <ChevronDown
            size={14}
            className={cn('transition-transform duration-150', open && 'rotate-180')}
          />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute left-0 top-full mt-1.5 z-30 min-w-[180px] surface-elevated rounded-xl p-1"
          >
            {ENTITY_OVERFLOW_OPTIONS.map(option => {
              const active = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'text-body hover:bg-muted hover:text-heading',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
