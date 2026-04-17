'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function UpdatePasswordView() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryReady(true)
        setError('')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  async function handleUpdatePassword() {
    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    setError('')

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccessMessage('¡Contraseña actualizada! Redirigiendo...')
    window.setTimeout(() => {
      window.location.href = '/operator-select'
    }, 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md">
        <h1 className="text-2xl font-bold text-foreground mb-1">Actualizar contraseña</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Definí una nueva contraseña para tu cuenta.
        </p>

        {!recoveryReady ? (
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Verificando enlace...
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Nueva contraseña"
              value={newPassword}
              onChange={event => {
                setNewPassword(event.target.value)
                setError('')
              }}
            />
            <Input
              type="password"
              placeholder="Confirmar contraseña"
              value={confirmPassword}
              onChange={event => {
                setConfirmPassword(event.target.value)
                setError('')
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  handleUpdatePassword()
                }
              }}
            />

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                {successMessage}
              </p>
            )}

            <Button
              className="w-full"
              onClick={handleUpdatePassword}
              disabled={loading || Boolean(successMessage)}
            >
              {loading ? 'Actualizando...' : 'Actualizar contraseña'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
