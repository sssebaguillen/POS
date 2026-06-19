'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, X } from '@phosphor-icons/react/dist/ssr'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { useFeedback, type FeedbackType } from '@/hooks/use-feedback'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  businessId: string
  onSuccess?: () => void
}

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: '🐛 Bug / error' },
  { value: 'sugerencia', label: '💡 Sugerencia' },
  { value: 'otro', label: '💬 Otro' },
]

const MAX_LEN = 1000
const MIN_LEN = 10
const RESET_DELAY_MS = 200

export default function FeedbackModal({ open, onOpenChange, businessId, onSuccess }: Props) {
  const { submit, isSubmitting, error, clearError } = useFeedback(businessId)
  const [type, setType] = useState<FeedbackType>('bug')
  const [message, setMessage] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const previewUrl = useMemo(
    () => (screenshot ? URL.createObjectURL(screenshot) : null),
    [screenshot]
  )

  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  // Reset form shortly after close to avoid flashing content during exit animation.
  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => {
      setType('bug')
      setMessage('')
      setContactEmail('')
      setScreenshot(null)
      clearError()
    }, RESET_DELAY_MS)
    return () => clearTimeout(timer)
  }, [open, clearError])

  const messageLen = message.trim().length
  const messageInvalid = messageLen > 0 && (messageLen < MIN_LEN || messageLen > MAX_LEN)
  const canSubmit = messageLen >= MIN_LEN && messageLen <= MAX_LEN && !isSubmitting

  async function handleSubmit() {
    const ok = await submit({
      type,
      message,
      contactEmail: contactEmail.trim() || null,
      screenshot,
    })
    if (ok) {
      onSuccess?.()
      onOpenChange(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setScreenshot(file)
    e.target.value = ''
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Enviar comentario</DialogTitle>
          <DialogDescription>
            Reportá un bug, mandá una sugerencia o contanos algo que te gustaría que cambie.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tipo</label>
            <SelectDropdown
              value={type}
              onChange={v => setType(v as FeedbackType)}
              options={TYPE_OPTIONS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Mensaje
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_LEN))}
              placeholder="Describí el problema o la sugerencia con todo el detalle que puedas…"
              rows={5}
              className={cn(
                'w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none outline-none transition-colors',
                'focus:ring-2 focus:ring-primary/30 focus:border-primary',
                messageInvalid
                  ? 'border-destructive/60 focus:border-destructive focus:ring-destructive/30'
                  : 'border-border'
              )}
            />
            <div className="flex items-center justify-between text-xs">
              <span className={cn(messageInvalid ? 'text-destructive' : 'text-muted-foreground')}>
                {messageLen < MIN_LEN && messageLen > 0
                  ? `Faltan ${MIN_LEN - messageLen} caracteres`
                  : ' '}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {messageLen}/{MAX_LEN}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Email de contacto <span className="text-muted-foreground/70">(opcional)</span>
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Captura <span className="text-muted-foreground/70">(opcional, ≤5 MB)</span>
            </label>
            {previewUrl ? (
              <div className="relative rounded-lg border border-border overflow-hidden bg-muted/30">
                {/* Use plain img — this is a local blob URL, not optimizable. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="preview"
                  className="block max-h-48 w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => setScreenshot(null)}
                  aria-label="Quitar imagen"
                  className="absolute top-1.5 right-1.5 rounded-md bg-background/90 p-1 shadow-sm hover:bg-background border border-border"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground hover:bg-muted/40 hover:border-primary/40 hover:text-foreground transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
              >
                <ImageIcon size={16} />
                Adjuntar imagen
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3 rounded-b-2xl">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="h-9 rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-9 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
