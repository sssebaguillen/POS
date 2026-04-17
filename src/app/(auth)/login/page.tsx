// src/app/(auth)/login/page.tsx
'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'

// 🔥 ESTA LÍNEA ES OBLIGATORIA para que funcione el nonce + CSP
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
      return
    }
    router.push('/')
  }

  async function handleForgotPassword() {
    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      setForgotError('Ingresá tu email primero')
      return
    }

    setForgotLoading(true)
    setForgotError('')

    try {
      await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: 'https://pulsarpos.vercel.app/auth/callback?type=recovery',
      })
      setForgotSent(true)
    } catch {
      setForgotError('Ocurrió un error, intentá de nuevo')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md">
        <h1 className="text-2xl font-bold text-foreground mb-1">Pulsar POS</h1>
        <p className="text-muted-foreground mb-6 text-sm">Ingresá a tu negocio</p>

        <div className="space-y-3">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleLogin} disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          ¿No tenés cuenta?{' '}
          <Link href="/register" className="text-primary hover:underline">
            Registrá tu negocio
          </Link>
        </p>

        <p className="text-center text-sm text-muted-foreground mt-2">
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
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {forgotError}
          </p>
        )}
      </div>
    </div>
  )
}
