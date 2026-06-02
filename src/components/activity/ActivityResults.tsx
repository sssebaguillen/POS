'use client'

import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import ActivityRow from '@/components/activity/ActivityRow'
import type { ActivityActionTone, ActivityLogRow, ActivityLookups } from '@/components/activity/types'
import { getAuditActionTone } from '@/lib/audit'
import { cn } from '@/lib/utils'

interface ActivityResultsProps {
  rows: ActivityLogRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  expanded: Set<string>
  lookups: ActivityLookups
  isPending: boolean
  hasActiveFilters: boolean
  onToggleRow: (id: string) => void
  onPageChange: (page: number) => void
  onClearFilters: () => void
}

export default function ActivityResults({
  rows,
  total,
  page,
  pageSize,
  totalPages,
  expanded,
  lookups,
  isPending,
  hasActiveFilters,
  onToggleRow,
  onPageChange,
  onClearFilters,
}: ActivityResultsProps) {
  const isEmpty = rows.length === 0

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 min-h-[20px]">
        <p className="text-caption text-hint">
          {isEmpty
            ? 'Sin eventos'
            : total > pageSize
              ? `${total.toLocaleString('es-AR')} eventos · página ${page} de ${totalPages}`
              : `${total.toLocaleString('es-AR')} ${total === 1 ? 'evento' : 'eventos'}`}
        </p>
        {hasActiveFilters && !isEmpty && (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-caption text-hint hover:text-primary transition-colors underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div
        className={cn(
          'surface-card overflow-x-auto transition-opacity duration-150',
          isPending && 'opacity-60 pointer-events-none',
        )}
      >
        {isEmpty ? (
          hasActiveFilters ? (
            <EmptyFilteredState onClearFilters={onClearFilters} />
          ) : (
            <EmptyActivityState />
          )
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b border-edge/60 text-left text-hint">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3 w-32">Fecha</th>
                <th className="px-4 py-3">Acción</th>
                <th className="px-4 py-3">Entidad</th>
                <th className="px-4 py-3 w-40">Operador</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const tone: ActivityActionTone = getAuditActionTone(row.action)
                return (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    isOpen={expanded.has(row.id)}
                    tone={tone}
                    lookups={lookups}
                    onToggle={() => onToggleRow(row.id)}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {!isEmpty && total > pageSize && (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border bg-card text-sm text-body hover:bg-muted hover:text-heading transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-body"
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
            Anterior
          </button>
          <span className="px-3 text-sm text-hint tabular-nums">
            {page} <span className="text-faint">/</span> {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border bg-card text-sm text-body hover:bg-muted hover:text-heading transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card disabled:hover:text-body"
            aria-label="Página siguiente"
          >
            Siguiente
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </>
  )
}

interface EmptyFilteredStateProps {
  onClearFilters: () => void
}

function EmptyFilteredState({ onClearFilters }: EmptyFilteredStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
      <Inbox size={36} className="text-hint" />
      <p className="text-heading font-semibold">Sin resultados</p>
      <p className="text-sm text-body max-w-sm">
        Ningún evento coincide con los filtros activos.
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className="mt-2 inline-flex items-center h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Limpiar filtros
      </button>
    </div>
  )
}

function EmptyActivityState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
      <Inbox size={36} className="text-hint" />
      <p className="text-heading font-semibold">Sin actividad registrada</p>
      <p className="text-sm text-body max-w-sm">
        Acá vas a ver cambios en ventas, productos, gastos, proveedores, listas de precios, configuración y operarios.
      </p>
    </div>
  )
}
