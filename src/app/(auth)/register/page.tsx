'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function RegisterPage() {
  const [businessName, setBusinessName] = useState('')
  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleRegister() {
    if (!businessName || !userName || !email || !password) {
      setError('Completá todos los campos')
      return
    }
    setLoading(true)
    setError('')

    // 1. Crear usuario en auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError || !authData.user) {
      setError(authError?.message || 'Error al crear la cuenta')
      setLoading(false)
      return
    }

    // 2. Llamar a la función del servidor que crea negocio y perfil
    //    con security definer — sin depender de la sesión del cliente
    const { data: result, error: rpcError } = await supabase.rpc('bootstrap_new_user', {
      p_user_id: authData.user.id,
      p_business_name: businessName,
      p_user_name: userName,
    })

    if (rpcError || !result?.success) {
      setError(result?.error || rpcError?.message || 'Error al configurar el negocio')
      setLoading(false)
      return
    }

    // 3. Iniciar sesión
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError('Cuenta creada. Por favor ingresá manualmente.')
      setLoading(false)
      return
    }

    // Clear any stale operator cookies from a previous session
    await fetch('/api/operator/logout', { method: 'POST' })

    router.push('/operator-select')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card p-8 rounded-xl shadow-sm border border-border w-full max-w-md">
        <h1 className="text-2xl font-bold text-foreground mb-2">Creá tu negocio</h1>
        <p className="text-muted-foreground mb-6">Empezá gratis, sin tarjeta de crédito</p>

        <div className="space-y-4">
          <Input
            placeholder="Nombre del negocio (ej: Kiosco Don Juan)"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
          />
          <Input
            placeholder="Tu nombre"
            value={userName}
            onChange={e => setUserName(e.target.value)}
          />
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Contraseña (mínimo 6 caracteres)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRegister()}
          />
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleRegister} disabled={loading}>
            {loading ? 'Creando negocio...' : 'Crear negocio gratis'}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          ¿Ya tenés cuenta?{' '}
          <a href="/login" className="text-primary hover:underline">
            Ingresá
          </a>
        </p>
      </div>
    </div>
  )
}
