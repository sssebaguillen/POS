'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OPERATOR_ROLE_LABELS, PROFILE_ROLE_LABELS, type OperatorRole } from '@/lib/constants/domain'
import { trackOperatorSwitch } from '@/lib/analytics'

interface OperatorListItem {
  id: string
  name: string
  role: OperatorRole
}

interface OwnerProfile {
  id: string
  name: string
}

interface OperatorSelectViewProps {
  ownerProfile: OwnerProfile
  operators: OperatorListItem[]
  availableOperatorsCount: number
}

interface SwitchResponse {
  success: boolean
  name?: string
  role?: string
  error?: string
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
}

const OWNER_CARD_ID = '__owner__'

export default function OperatorSelectView({ ownerProfile, operators, availableOperatorsCount }: OperatorSelectViewProps) {
  const router = useRouter()
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const supabase = useMemo(() => createClient(), [])

  const selectedOperator = useMemo(
    () => operators.find(operator => operator.id === selectedOperatorId) ?? null,
    [operators, selectedOperatorId]
  )

  const isOwnerSelected = selectedOperatorId === OWNER_CARD_ID

  function handleSelectOperator(operatorId: string) {
    setSelectedOperatorId(operatorId)
    setPin('')
    setPassword('')
    setError('')
    setForgotError('')
    setForgotLoading(false)
    setForgotSent(false)
  }

  function handlePinChange(value: string) {
    const normalizedPin = value.replace(/\D/g, '').slice(0, 4)
    setPin(normalizedPin)
    setError('')
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedOperatorId) {
      setError('Seleccioná un operador para continuar.')
      return
    }

    setLoading(true)
    setError('')

    const response = await fetch('/api/operator/switch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: isOwnerSelected
        ? JSON.stringify({ isOwner: true, password })
        : JSON.stringify({ profile_id: selectedOperatorId, pin }),
    })

    const payload = (await response.json().catch(() => null)) as SwitchResponse | null

    setLoading(false)

    if (!response.ok || !payload?.success) {
      setError(payload?.error ?? (isOwnerSelected ? 'Contraseña incorrecta' : 'No se pudo iniciar el turno con ese PIN.'))
      if (isOwnerSelected) {
        setPassword('')
      } else {
        setPin('')
      }
      return
    }

    trackOperatorSwitch()

    window.location.href = '/pos'
  }

  function handleGoToSettings() {
    router.push('/settings')
    router.refresh()
  }

  async function handleForgotPassword() {
    if (!isOwnerSelected) {
      return
    }

    setForgotLoading(true)
    setForgotError('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user?.email) {
        setForgotError('Ingresá tu email primero')
        return
      }

      await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: 'https://pulsarpos.vercel.app/auth/update-password',
      })

      setForgotSent(true)
    } catch {
      setForgotError('Ocurrió un error, intentá de nuevo')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Inicio de turno</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Selecciona operador</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Elegi un operador y valida el PIN para usar el sistema.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => handleSelectOperator(OWNER_CARD_ID)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                isOwnerSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border/60 bg-background hover:bg-muted/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-sm font-semibold text-foreground">
                  {getInitials(ownerProfile.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{ownerProfile.name}</p>
                  <Badge variant="secondary" className="mt-1 text-[10px] uppercase tracking-wide">
                    {PROFILE_ROLE_LABELS.owner}
                  </Badge>
                </div>
              </div>
            </button>

            {operators.map(operator => {
              const isSelected = operator.id === selectedOperatorId

              return (
                <button
                  key={operator.id}
                  type="button"
                  onClick={() => handleSelectOperator(operator.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border/60 bg-background hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-sm font-semibold text-foreground">
                      {getInitials(operator.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{operator.name}</p>
                      <Badge variant="secondary" className="mt-1 text-[10px] uppercase tracking-wide">
                        {OPERATOR_ROLE_LABELS[operator.role]}
                      </Badge>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

        {availableOperatorsCount === 0 && (
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
            <p>No hay operadores creados. Crea uno desde Configuracion.</p>
            <div className="mt-3">
              <Button
                type="button"
                className="bg-primary text-white hover:bg-primary/90"
                onClick={handleGoToSettings}
              >
                Ir a Configuracion
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 max-w-xs space-y-3">
          <label htmlFor="operator-credential" className="text-xs uppercase tracking-wide text-muted-foreground">
            {isOwnerSelected ? 'Contraseña' : 'PIN del operador'}
          </label>
          <Input
            id="operator-credential"
            type="password"
            inputMode={isOwnerSelected ? undefined : 'numeric'}
            autoComplete="off"
            value={isOwnerSelected ? password : pin}
            onChange={event => {
              if (isOwnerSelected) {
                setPassword(event.target.value)
                setError('')
              } else {
                handlePinChange(event.target.value)
              }
            }}
            maxLength={isOwnerSelected ? undefined : 4}
            placeholder={isOwnerSelected ? 'Ingresa tu contraseña' : '4 digitos'}
            disabled={(!selectedOperator && !isOwnerSelected) || loading}
          />

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={
              loading ||
              (!isOwnerSelected && (!selectedOperator || pin.length !== 4)) ||
              (isOwnerSelected && password.trim().length === 0)
            }
            className="w-full bg-primary text-white hover:bg-primary/90"
          >
            {loading ? 'Validando...' : 'Iniciar turno'}
          </Button>
        </form>

        {isOwnerSelected && error && (
          <div className="mt-3 max-w-xs space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-primary hover:underline disabled:opacity-50"
                disabled={forgotLoading || forgotSent}
              >
                {forgotSent ? 'Revisá tu email' : '¿Olvidaste tu contraseña?'}
              </button>
            </p>
            {forgotError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {forgotError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
