'use client'

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

interface SelectDropdownProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
  usePortal?: boolean
  renderOption?: (option: { value: string; label: string }) => React.ReactNode
  renderSelected?: (option: { value: string; label: string }) => React.ReactNode
}

export default function SelectDropdown({ value, onChange, options, placeholder, className, usePortal, renderOption, renderSelected }: SelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})

  const selectedOption = options.find(o => o.value === value)
  const selectedLabel = selectedOption?.label ?? placeholder ?? ''

  function computeDropdownStyle() {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const estimatedHeight = Math.min(options.length * 36 + 8, 300)
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    } else {
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    }
  }

  useEffect(() => {
    if (!open) return
    if (usePortal) computeDropdownStyle()
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node
      const inContainer = containerRef.current?.contains(target) ?? false
      const inDropdown = dropdownRef.current?.contains(target) ?? false
      if (!inContainer && !inDropdown) setOpen(false)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const dropdownList = (
    <div
      ref={dropdownRef}
      className={`animate-in fade-in-0 zoom-in-95 origin-top duration-150 overflow-hidden surface-elevated ${!usePortal ? 'absolute z-50 w-full mt-1' : ''}`}
      style={usePortal ? dropdownStyle : undefined}
    >
      {options.map(option => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => { onChange(option.value); setOpen(false) }}
            className={`w-full px-3 py-2 text-sm flex items-center justify-between gap-2 cursor-pointer hover:bg-surface-alt transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] text-left ${
              isActive ? 'text-primary font-medium' : 'text-body'
            }`}
          >
            {renderOption ? renderOption(option) : <span>{option.label}</span>}
            {isActive && <Check size={13} className="shrink-0 text-primary" />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="h-9 w-full rounded-lg border border-input bg-card text-sm text-body px-3 flex items-center justify-between gap-2 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] hover:bg-surface-alt dark:bg-input/30"
      >
        {renderSelected && selectedOption
          ? <span className="truncate flex items-center gap-2">{renderSelected(selectedOption)}</span>
          : <span className="truncate">{selectedLabel}</span>
        }
        <ChevronDown size={14} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (usePortal ? createPortal(dropdownList, document.body) : dropdownList)}
    </div>
  )
}
