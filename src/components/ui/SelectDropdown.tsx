'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

interface SelectDropdownProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
}

export default function SelectDropdown({ value, onChange, options, placeholder, className }: SelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find(o => o.value === value)?.label ?? placeholder ?? ''

  useEffect(() => {
    if (!open) return
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="h-9 w-full rounded-xl border border-edge bg-surface text-sm text-body px-3 flex items-center justify-between gap-2 transition-colors hover:bg-surface-alt"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={14} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1 overflow-hidden surface-elevated">
          {options.map(option => {
            const isActive = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false) }}
                className={`w-full px-3 py-2 text-sm flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-alt transition-colors text-left ${isActive ? 'text-primary font-medium' : 'text-body'}`}
              >
                <span>{option.label}</span>
                {isActive && <Check size={13} className="shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
