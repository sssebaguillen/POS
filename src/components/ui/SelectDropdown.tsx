'use client'

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, CaretDown } from '@phosphor-icons/react/dist/ssr'

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

type DropdownPhase = 'closed' | 'pre' | 'open' | 'closing'
type DropdownOrigin = 'top-left' | 'bottom-left'

export default function SelectDropdown({ value, onChange, options, placeholder, className, usePortal, renderOption, renderSelected }: SelectDropdownProps) {
  const [phase, setPhase] = useState<DropdownPhase>('closed')
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeMs = useRef(150)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const [origin, setOrigin] = useState<DropdownOrigin>('top-left')

  const open = phase === 'pre' || phase === 'open'
  const selectedOption = options.find(o => o.value === value)
  const selectedLabel = selectedOption?.label ?? placeholder ?? ''

  useEffect(() => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur'))
    if (v) closeMs.current = v
  }, [])

  function computeDropdownStyle() {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const estimatedHeight = Math.min(options.length * 36 + 8, 300)
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
      setOrigin('bottom-left')
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    } else {
      setOrigin('top-left')
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    }
  }

  function openDropdown() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    if (usePortal) computeDropdownStyle()
    else setOrigin('top-left')
    setPhase('pre')
  }

  function closeDropdown() {
    setPhase(p => (p === 'closed' ? p : 'closing'))
  }

  // Drive the open/close animation phases. Pre → open on the next frame so the
  // transition runs; closing → closed after --dropdown-close-dur so the closing
  // scale animates before the element unmounts and resets to its pre-open rest.
  useEffect(() => {
    if (phase === 'pre') {
      const id = requestAnimationFrame(() => setPhase('open'))
      return () => cancelAnimationFrame(id)
    }
    if (phase === 'closing') {
      closeTimer.current = setTimeout(() => setPhase('closed'), closeMs.current)
      return () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
    }
  }, [phase])

  useEffect(() => {
    if (phase === 'closed') return
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node
      const inContainer = containerRef.current?.contains(target) ?? false
      const inDropdown = dropdownRef.current?.contains(target) ?? false
      if (!inContainer && !inDropdown) closeDropdown()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDropdown()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [phase])

  const stateClass = phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : ''
  const dropdownList = (
    <div
      ref={dropdownRef}
      data-origin={origin}
      className={`t-dropdown ${stateClass} overflow-hidden surface-elevated ${!usePortal ? 'absolute z-50 w-full mt-1' : ''}`}
      style={usePortal ? dropdownStyle : undefined}
    >
      {options.map(option => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => { onChange(option.value); closeDropdown() }}
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
        onClick={() => (open ? closeDropdown() : openDropdown())}
        className="h-9 w-full rounded-lg border border-input bg-card text-sm text-body px-3 flex items-center justify-between gap-2 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] hover:bg-surface-alt dark:bg-input/30"
      >
        {renderSelected && selectedOption
          ? <span className="truncate flex items-center gap-2">{renderSelected(selectedOption)}</span>
          : <span className="truncate">{selectedLabel}</span>
        }
        <CaretDown size={14} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {phase !== 'closed' && (usePortal ? createPortal(dropdownList, document.body) : dropdownList)}
    </div>
  )
}
