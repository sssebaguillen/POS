'use client'

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** When true, both buttons disabled and confirmLabel is replaced with `loadingLabel`. */
  loading?: boolean
  loadingLabel?: string
  /** Error message shown inside the modal, below the message (e.g. for inline RPC failure feedback). */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  loading = false,
  loadingLabel,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const effectiveConfirmLabel = loading ? (loadingLabel ?? 'Procesando...') : confirmLabel

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !loading) onCancel() }}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl" aria-describedby={undefined}>
        <div className="px-5 py-4 space-y-1">
          <DialogTitle className="font-semibold text-heading">{title}</DialogTitle>
          {typeof message === 'string'
            ? <p className="text-sm text-body">{message}</p>
            : <div className="text-sm text-body">{message}</div>}
        </div>
        {error && (
          <p className="mx-5 mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-edge">
          <Button variant="cancel" className="h-9 px-5 rounded-lg text-sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" className="h-9 px-5 rounded-lg text-sm" onClick={onConfirm} disabled={loading}>
            {effectiveConfirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
