'use client'

import { useState, useMemo } from 'react'
import { User } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import EditEmailPanel from '@/components/profile/EditEmailPanel'
import EditPasswordPanel from '@/components/profile/EditPasswordPanel'

interface ProfileData {
  id: string
  name: string
  avatar_url: string | null
  business_id: string
}

interface BusinessData {
  name: string
  plan: string
}

interface Props {
  profile: ProfileData
  email: string
  business: BusinessData
}

export default function ProfileView({ profile, email, business }: Props) {
  const supabase = useMemo(() => createClient(), [])

  const [name, setName] = useState(profile.name)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(profile.name)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const [panel, setPanel] = useState<'email' | 'password' | null>(null)

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')

  async function saveName() {
    if (!nameInput.trim()) { setNameError('El nombre no puede estar vacío'); return }
    setNameSaving(true)
    setNameError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ name: nameInput.trim() })
      .eq('id', profile.id)
    setNameSaving(false)
    if (error) { setNameError(error.message); return }
    setName(nameInput.trim())
    setEditingName(false)
  }

  function cancelEditName() {
    setNameInput(name)
    setNameError(null)
    setEditingName(false)
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="max-w-lg mx-auto py-8 px-4 space-y-6">

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={name}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-primary">
                {initials || <User size={32} />}
              </span>
            )}
          </div>
          <button
            type="button"
            className="text-sm text-hint hover:text-body transition-colors"
            onClick={() => alert('Próximamente')}
          >
            Cambiar foto
          </button>
        </div>

        {/* Info */}
        <div className="surface-elevated rounded-2xl divide-y divide-edge/40">

          {/* Nombre */}
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Nombre</p>
            {editingName ? (
              <div className="space-y-2">
                <Input
                  value={nameInput}
                  onChange={e => { setNameInput(e.target.value); setNameError(null) }}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') cancelEditName() }}
                />
                {nameError && (
                  <p className="text-sm text-destructive">{nameError}</p>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={cancelEditName} disabled={nameSaving}>
                    Cancelar
                  </Button>
                  <Button size="sm" className="btn-primary-gradient" onClick={saveName} disabled={nameSaving}>
                    {nameSaving ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-heading">{name}</span>
                <button
                  type="button"
                  onClick={() => { setNameInput(name); setEditingName(true) }}
                  className="text-sm text-hint hover:text-body transition-colors"
                >
                  Editar
                </button>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Email</p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-heading">{email}</span>
              <button
                type="button"
                onClick={() => setPanel('email')}
                className="text-sm text-hint hover:text-body transition-colors"
              >
                Editar
              </button>
            </div>
          </div>

          {/* Password */}
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Contraseña</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-hint">••••••••</span>
              <button
                type="button"
                onClick={() => setPanel('password')}
                className="text-sm text-hint hover:text-body transition-colors"
              >
                Cambiar
              </button>
            </div>
          </div>
        </div>

        {/* Business info */}
        <div className="surface-elevated rounded-2xl divide-y divide-edge/40">
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Negocio</p>
            <span className="text-sm font-medium text-heading">{business.name}</span>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Plan</p>
            <span className="text-sm font-medium text-heading capitalize">{business.plan}</span>
          </div>
          <div className="px-5 py-4">
            <Link
              href="/settings"
              className="text-sm text-hint hover:text-body transition-colors"
            >
              Ir a configuración
            </Link>
          </div>
        </div>
      </div>

      {/* Side panels */}
      {panel === 'email' && (
        <EditEmailPanel onClose={() => setPanel(null)} />
      )}
      {panel === 'password' && (
        <EditPasswordPanel onClose={() => setPanel(null)} />
      )}
    </div>
  )
}
