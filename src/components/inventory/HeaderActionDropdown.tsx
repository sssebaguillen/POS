'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'

export interface HeaderDropdownItem {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

interface Props {
  /** Icono del trigger compacto (mobile). */
  icon: ReactNode
  ariaLabel: string
  items: HeaderDropdownItem[]
  /** Deshabilita el trigger compacto (mobile). Las acciones de desktop usan item.disabled. */
  triggerDisabled?: boolean
}

/**
 * Acción de header responsive: en desktop muestra botones planos; en mobile colapsa a un
 * icono que abre un menú en portal (para escapar overflow:hidden del header). La posición
 * se mide al abrir y se guarda en estado — nunca se lee un ref durante el render.
 */
export default function HeaderActionDropdown({ icon, ariaLabel, items, triggerDisabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (wrapperRef.current?.contains(t) || portalRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(prev => !prev)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={triggerDisabled}
        className="inv:hidden p-1.5 rounded-lg border border-edge hover:bg-surface-alt transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {icon}
      </button>

      <div className="hidden inv:flex items-center gap-2">
        {items.map(item => (
          <Button
            key={item.label}
            variant="outline"
            size="sm"
            className="rounded-lg text-xs"
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.title}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={portalRef}
          className="inv:hidden"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999, minWidth: 140 }}
        >
          <div className="rounded-lg border border-edge bg-surface shadow-lg py-1 animate-in fade-in-0 zoom-in-95 origin-top-right duration-150">
            {items.map(item => (
              <button
                key={item.label}
                type="button"
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-alt transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick() }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
