'use client'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) onCancel() }}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl">
        <div className="px-5 py-4 space-y-1">
          <p className="font-semibold text-heading">{title}</p>
          <p className="text-sm text-body">{message}</p>
        </div>
        <div className="px-5 py-3 bg-muted/40 flex justify-end gap-2 border-t border-edge-soft">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" className="btn-danger rounded-lg" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
