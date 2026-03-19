'use client'

import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  onClose: () => void
}

export default function EditPasswordPanel({ onClose }: Props) {
  const supabase = useMemo(() => createClient(), [])
  // NOTE: Supabase's updateUser({ password }) does not verify the current password server-side.
  // The current password field is included here purely as a UX safeguard to prevent accidental changes.
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function validate(): string | null {
    if (!currentPassword) return 'Ingresá tu contraseña actual'
    if (newPassword.length < 8) return 'La nueva contraseña debe tener al menos 8 caracteres'
    if (newPassword !== confirmPassword) return 'Las contraseñas no coinciden'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) { setError(validationError); return }
    setSaving(true)
    setError(null)
    const { error: authError } = await supabase.auth.updateUser({ password: newPassword })
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
        <h2 className="font-semibold text-heading">Cambiar contraseña</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 px-5 py-6">
        {success ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800/50 px-4 py-4">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Contraseña actualizada correctamente
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-body">Contraseña actual</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={e => { setCurrentPassword(e.target.value); setError(null) }}
                placeholder="Contraseña actual"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-body">Nueva contraseña</label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setError(null) }}
                placeholder="Mínimo 8 caracteres"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-body">Confirmar nueva contraseña</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null) }}
                placeholder="Repetí la nueva contraseña"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" className="btn-primary-gradient flex-1" disabled={saving}>
                {saving ? 'Guardando...' : 'Cambiar contraseña'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
