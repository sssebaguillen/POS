'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OPERATOR_ROLE_LABELS, PROFILE_ROLE_LABELS, type OperatorRole } from '@/lib/constants/domain'
import { trackOperatorSwitch } from '@/lib/analytics'

const DEFAULT_PIN_LENGTH = 4
const OWNER_CARD_ID = '__owner__'

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

interface PinDotsProps {
  pinLength: number
  filled: number
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

function PinDots({ pinLength, filled }: PinDotsProps) {
  return (
    <div
      role="group"
      aria-label={`PIN: ${filled} de ${pinLength} dígitos ingresados`}
      className="flex items-center justify-center gap-4 py-5"
    >
      {Array.from({ length: pinLength }).map((_, i) => (
        <span
          key={i}
          className={`block h-3 w-3 rounded-full transition-colors duration-100 ${
            i < filled ? 'bg-foreground' : 'border-2 border-border'
          }`}
        />
      ))}
    </div>
  )
}

export default function OperatorSelectView({
  ownerProfile,
  operators,
  availableOperatorsCount,
}: OperatorSelectViewProps) {
  const [step, setStep] = useState<'select' | 'auth'>('select')
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const pinInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const supabase = useMemo(() => createClient(), [])

  const selectedOperator = useMemo(
    () => operators.find(op => op.id === selectedOperatorId) ?? null,
    [operators, selectedOperatorId]
  )
  const isOwnerSelected = selectedOperatorId === OWNER_CARD_ID
  // Future: selectedOperator?.pin_length ?? DEFAULT_PIN_LENGTH once the column exists
  const pinLength = DEFAULT_PIN_LENGTH

  const selectedName = isOwnerSelected ? ownerProfile.name : selectedOperator?.name ?? ''
  const selectedRole = isOwnerSelected
    ? PROFILE_ROLE_LABELS.owner
    : selectedOperator
      ? OPERATOR_ROLE_LABELS[selectedOperator.role]
      : ''

  useEffect(() => {
    if (step !== 'auth') return
    const timer = setTimeout(() => {
      if (isOwnerSelected) {
        passwordInputRef.current?.focus()
      } else {
        pinInputRef.current?.focus()
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [step, isOwnerSelected])

  function handleSelectOperator(operatorId: string) {
    setSelectedOperatorId(operatorId)
    setPin('')
    setPassword('')
    setError('')
    setForgotError('')
    setForgotLoading(false)
    setForgotSent(false)
    setStep('auth')
  }

  function handleBack() {
    setStep('select')
    setSelectedOperatorId(null)
    setPin('')
    setPassword('')
    setError('')
    setForgotError('')
    setForgotLoading(false)
    setForgotSent(false)
  }

  async function submitCredential(pinOverride?: string) {
    if (!selectedOperatorId) return
    setLoading(true)
    setError('')

    const effectivePin = pinOverride ?? pin

    const response = await fetch('/api/operator/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: isOwnerSelected
        ? JSON.stringify({ isOwner: true, password })
        : JSON.stringify({ profile_id: selectedOperatorId, pin: effectivePin }),
    })

    const payload = (await response.json().catch(() => null)) as SwitchResponse | null
    setLoading(false)

    if (!response.ok || !payload?.success) {
      setError(
        payload?.error ?? (isOwnerSelected ? 'Contraseña incorrecta.' : 'PIN incorrecto.')
      )
      if (isOwnerSelected) setPassword('')
      else setPin('')
      return
    }

    trackOperatorSwitch()
    window.location.href = '/pos'
  }

  function handlePinChange(value: string) {
    const normalized = value.replace(/\D/g, '').slice(0, pinLength)
    setPin(normalized)
    if (error) setError('')
    if (normalized.length === pinLength && !loading) {
      void submitCredential(normalized)
    }
  }

  function handleGoToSettings() {
    window.location.href = '/settings'
  }

  async function handleForgotPassword() {
    if (!isOwnerSelected) return
    setForgotLoading(true)
    setForgotError('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user?.email) {
        setForgotError('No se pudo obtener el email de la cuenta.')
        return
      }

      await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      })

      setForgotSent(true)
    } catch {
      setForgotError('Ocurrió un error, intentá de nuevo.')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 pb-8 pt-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">

        {step === 'select' && (
          <div className="animate-fade-in">
            <div className="mb-8">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Inicio de turno</p>
              <h1 className="mt-1 text-2xl font-bold text-foreground">Seleccioná un operador</h1>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                onClick={() => handleSelectOperator(OWNER_CARD_ID)}
                className="rounded-xl border border-primary/30 bg-background p-4 text-left transition-colors hover:bg-primary/5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {getInitials(ownerProfile.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{ownerProfile.name}</p>
                    <Badge variant="default" className="mt-1 text-[10px] uppercase tracking-wide">
                      {PROFILE_ROLE_LABELS.owner}
                    </Badge>
                  </div>
                </div>
              </button>

              {operators.map(operator => (
                <button
                  key={operator.id}
                  type="button"
                  onClick={() => handleSelectOperator(operator.id)}
                  className="rounded-xl border border-border/60 bg-background p-4 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-sm font-semibold text-foreground">
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
              ))}
            </div>

            {availableOperatorsCount === 0 && (
              <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                <p>No hay operadores creados. Creá uno desde Configuración.</p>
                <div className="mt-3">
                  <Button
                    type="button"
                    className="bg-primary text-white hover:bg-primary/90"
                    onClick={handleGoToSettings}
                  >
                    Ir a Configuración
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'auth' && (
          <div className="animate-fade-in">
            <button
              type="button"
              onClick={handleBack}
              className="-ml-1 flex h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Volver
            </button>

            <div className="mt-6 flex flex-col items-center gap-2 text-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold ${
                  isOwnerSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border/60 bg-muted/30 text-foreground'
                }`}
              >
                {getInitials(selectedName)}
              </div>
              <p className="text-base font-semibold text-foreground">{selectedName}</p>
              <Badge
                variant={isOwnerSelected ? 'default' : 'secondary'}
                className="text-[10px] uppercase tracking-wide"
              >
                {selectedRole}
              </Badge>
            </div>

            <form
              onSubmit={e => { e.preventDefault(); void submitCredential() }}
              className="mx-auto mt-8 w-full max-w-xs space-y-4"
            >
              {isOwnerSelected ? (
                <div className="space-y-2">
                  <label htmlFor="owner-password" className="text-xs uppercase tracking-wide text-muted-foreground">
                    Contraseña
                  </label>
                  <Input
                    ref={passwordInputRef}
                    id="owner-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value)
                      if (error) setError('')
                    }}
                    placeholder="Tu contraseña"
                    disabled={loading}
                    className="h-11"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">
                    PIN
                  </label>
                  <div className="relative">
                    <PinDots pinLength={pinLength} filled={pin.length} />
                    <input
                      ref={pinInputRef}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={pinLength}
                      value={pin}
                      onChange={e => handlePinChange(e.target.value)}
                      disabled={loading}
                      aria-label="PIN del operador"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={
                  loading ||
                  (isOwnerSelected && password.trim().length === 0) ||
                  (!isOwnerSelected && pin.length !== pinLength)
                }
                className="h-11 w-full bg-primary text-white hover:bg-primary/90"
              >
                {loading ? 'Validando...' : 'Iniciar turno'}
              </Button>

              {isOwnerSelected && error && (
                <div className="space-y-2 pt-1 text-center">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-sm text-primary hover:underline disabled:opacity-50"
                    disabled={forgotLoading || forgotSent}
                  >
                    {forgotSent ? 'Revisá tu email' : '¿Olvidaste tu contraseña?'}
                  </button>
                  {forgotError && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {forgotError}
                    </p>
                  )}
                </div>
              )}
            </form>
          </div>
        )}

      </div>
    </div>
  )
}
