'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl" aria-describedby={undefined}>
        <div className="px-5 py-4 space-y-1">
          <DialogTitle className="font-semibold text-heading">{title}</DialogTitle>
          <p className="text-sm text-body">{message}</p>
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-edge">
          <Button variant="cancel" className="h-9 px-5 rounded-lg text-sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" className="h-9 px-5 rounded-lg text-sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
