'use client'

import { useEffect, useRef, useState } from 'react'
import type { PriceList } from '@/lib/types'

interface Props {
  selectedListIds: Set<string>
  priceLists: PriceList[]
  onChange: (next: Set<string>) => void
}

export default function PriceOverrideIndicator({ selectedListIds, priceLists, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const count = selectedListIds.size
  const summary = count === 0
    ? 'Sin listas aplicadas'
    : count === 1
      ? '1 lista aplicada'
      : `${count} listas aplicadas`

  function toggleList(id: string) {
    const next = new Set(selectedListIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <span ref={wrapRef} className="relative inline-block leading-none">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-label={`Precio personalizado, ${summary}. Click para configurar listas afectadas.`}
        aria-expanded={open}
        title={`Precio personalizado · ${summary}`}
        className="inline-flex items-center gap-1 px-1 py-0.5 -mx-1 rounded transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
        <span className="text-[10px] font-medium normal-case tracking-normal text-primary/80">
          personalizado
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Listas de precios afectadas"
          className="absolute top-full left-0 mt-1.5 z-50 w-64 surface-elevated p-3 normal-case tracking-normal animate-in fade-in-0 zoom-in-95 origin-top-left duration-150"
        >
          <p className="text-xs text-subtle mb-2">Aplicar este precio personalizado en:</p>
          {priceLists.length === 0 ? (
            <p className="text-caption text-hint">No hay listas de precios configuradas.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {priceLists.map(list => {
                const isChecked = selectedListIds.has(list.id)
                return (
                  <label key={list.id} className="flex items-center gap-2 cursor-pointer select-none">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      onClick={() => toggleList(list.id)}
                      className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                        isChecked ? 'bg-primary border-primary' : 'border-edge bg-surface'
                      }`}
                    >
                      {isChecked && (
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none stroke-primary-foreground stroke-[2]">
                          <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <span className="text-xs text-body">
                      {list.name}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      )}
    </span>
  )
}
