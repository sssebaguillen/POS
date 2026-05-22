'use client'

import { useMemo, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ERR } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function UpdatePasswordView() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [sessionReady, setSessionReady] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) {
      setSessionReady(true)
      return
    }
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setError(ERR.AUT71)
      } else {
        setSessionReady(true)
      }
    })
  }, [supabase])

  async function handleUpdatePassword() {
    if (newPassword.length < 8) {
      setError(ERR.AUT41)
      return
    }

    if (newPassword !== confirmPassword) {
      setError(ERR.AUT42)
      return
    }

    setLoading(true)
    setError('')

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (updateError) {
        setError(ERR.AUT1)
        return
      }

      setSuccessMessage('¡Contraseña actualizada! Redirigiendo...')
      window.setTimeout(() => {
        window.location.href = '/operator-select'
      }, 2000)
    } catch {
      setError(ERR.AUT1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md">
        <h1 className="text-2xl font-bold text-foreground mb-1">Actualizar contraseña</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Define una nueva contraseña para tu cuenta.
        </p>

        <div className="space-y-3">
          <Input
            type="password"
            placeholder="Nueva contraseña (mín. 8 caracteres)"
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
              if (event.key === 'Enter') handleUpdatePassword()
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
            disabled={loading || Boolean(successMessage) || !sessionReady}
          >
            {loading ? 'Actualizando...' : 'Actualizar contraseña'}
          </Button>
        </div>
      </div>
    </div>
  )
}
