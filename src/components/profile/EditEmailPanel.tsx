'use client'

import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  onClose: () => void
}

export default function EditEmailPanel({ onClose }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    setSaving(true)
    setError(null)
    const { error: authError } = await supabase.auth.updateUser({ email: newEmail.trim() })
    setSaving(false)
    if (authError) {
      setError(authError.message)
      return
    }
    setSuccess(true)
  }

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col">
      <div className="h-14 border-b border-edge/60 flex items-center justify-between px-5 shrink-0">
        <h2 className="font-semibold text-heading">Cambiar email</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 px-5 py-6 space-y-5">
        {success ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800/50 px-4 py-4 space-y-1">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Email enviado</p>
            <p className="text-sm text-emerald-600 dark:text-emerald-500">
              Se envió un email de confirmación a <strong>{newEmail}</strong>. Revisá tu bandeja para completar el cambio.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-body">Nuevo email</label>
              <Input
                type="email"
                value={newEmail}
                onChange={e => { setNewEmail(e.target.value); setError(null) }}
                placeholder="nuevo@email.com"
                required
                autoFocus
              />
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/50 px-4 py-3">
              <p className="text-sm text-blue-700 dark:text-blue-400">
                Se enviará un email de confirmación a la nueva dirección. El cambio no tendrá efecto hasta que lo confirmes.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" className="btn-primary-gradient flex-1" disabled={saving || !newEmail.trim()}>
                {saving ? 'Enviando...' : 'Confirmar cambio'}
              </Button>
            </div>
          </form>
        )}

        {success && (
          <Button variant="outline" className="w-full" onClick={onClose}>
            Cerrar
          </Button>
        )}
      </div>
    </div>
  )
}
