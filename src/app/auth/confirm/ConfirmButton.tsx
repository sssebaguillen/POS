'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CircleNotch, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { confirmEmail } from './actions'

type State = 'idle' | 'loading' | 'success'

interface Props {
  token_hash: string
  type: 'email' | 'recovery' | 'invite' | 'email_change'
}

export function ConfirmButton({ token_hash, type }: Props) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setState('loading')
    setError(null)
    const result = await confirmEmail(token_hash, type)
    if (result?.error) {
      setError(result.error)
      setState('idle')
      return
    }
    setState('success')
  }

  if (state === 'success') {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-green-600">
        <CheckCircle className="h-5 w-5" />
        <span>¡Cuenta confirmada! Redirigiendo...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={state === 'loading'}
        onClick={handleConfirm}
      >
        {state === 'loading' ? (
          <>
            <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
            Confirmando...
          </>
        ) : (
          'Confirmar mi cuenta'
        )}
      </Button>
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
