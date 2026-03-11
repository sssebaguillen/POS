'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function RegisterPage() {
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleRegister() {
    if (!businessName || !email || !password) {
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

    // 2. Crear negocio
    const slug = businessName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .insert({ name: businessName, slug: `${slug}-${Date.now()}` })
      .select()
      .single()

    if (bizError || !business) {
      setError('Error al crear el negocio')
      setLoading(false)
      return
    }

    // 3. Crear perfil
    await supabase.from('profiles').insert({
      id: authData.user.id,
      business_id: business.id,
      role: 'owner',
      name: businessName,
    })

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Creá tu negocio</h1>
        <p className="text-gray-500 mb-6">Empezá gratis, sin tarjeta de crédito</p>

        <div className="space-y-4">
          <Input
            placeholder="Nombre del negocio (ej: Kiosco Don Juan)"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
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
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button className="w-full" onClick={handleRegister} disabled={loading}>
            {loading ? 'Creando negocio...' : 'Crear negocio gratis'}
          </Button>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          ¿Ya tenés cuenta?{' '}
          <a href="/login" className="text-blue-600 hover:underline">
            Ingresá
          </a>
        </p>
      </div>
    </div>
  )
}