'use client'

import { useState, useMemo } from 'react'
import { User } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

  // --- Name ---
  const [name, setName] = useState(profile.name)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(profile.name)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // --- Email ---
  const [editingEmail, setEditingEmail] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState(false)

  // --- Password ---
  const [editingPassword, setEditingPassword] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)

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
    if (error) { console.error(error); setNameError('No pudimos guardar el cambio. Intenta de nuevo.'); return }
    setName(nameInput.trim())
    setEditingName(false)
  }

  function cancelEditName() {
    setNameInput(name)
    setNameError(null)
    setEditingName(false)
  }

  async function saveEmail() {
    if (!emailInput.trim()) return
    setEmailSaving(true)
    setEmailError(null)
    const { error } = await supabase.auth.updateUser({ email: emailInput.trim() })
    setEmailSaving(false)
    if (error) {
      console.error(error)
      const msg = error.message.toLowerCase().includes('already') || error.message.toLowerCase().includes('registered')
        ? 'Ese email ya está en uso.'
        : 'No pudimos actualizar el email. Intenta de nuevo.'
      setEmailError(msg)
      return
    }
    setEmailSuccess(true)
  }

  function cancelEditEmail() {
    setEmailInput('')
    setEmailError(null)
    setEmailSuccess(false)
    setEditingEmail(false)
  }

  function validatePassword(): string | null {
    if (!currentPw) return 'Ingresa tu contraseña actual'
    if (newPw.length < 8) return 'La nueva contraseña debe tener al menos 8 caracteres'
    if (newPw !== confirmPw) return 'Las contraseñas no coinciden'
    return null
  }

  async function savePassword() {
    const validationError = validatePassword()
    if (validationError) { setPwError(validationError); return }
    setPwSaving(true)
    setPwError(null)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setPwSaving(false)
    if (error) {
      console.error(error)
      const msg = error.message.toLowerCase().includes('least')
        ? 'La contraseña debe tener al menos 8 caracteres.'
        : 'No pudimos cambiar la contraseña. Intenta de nuevo.'
      setPwError(msg)
      return
    }
    setPwSuccess(true)
  }

  function cancelEditPassword() {
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setPwError(null)
    setPwSuccess(false)
    setEditingPassword(false)
  }

  return (
    <div className="flex-1 overflow-auto">
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
                {nameError && <p className="text-sm text-destructive">{nameError}</p>}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={cancelEditName} disabled={nameSaving}>Cancelar</Button>
                  <Button size="sm" onClick={saveName} disabled={nameSaving}>
                    {nameSaving ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-heading">{name}</span>
                <button type="button" onClick={() => { setNameInput(name); setEditingName(true) }} className="text-sm text-hint hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]">
                  Editar
                </button>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Email</p>
            {editingEmail ? (
              emailSuccess ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 space-y-1">
                    <p className="text-sm font-medium text-primary">Email enviado</p>
                    <p className="text-sm text-body">
                      Se envió un email de confirmación a <strong>{emailInput}</strong>. Revisa tu bandeja para completar el cambio.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={cancelEditEmail}>Cerrar</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Input
                    type="email"
                    value={emailInput}
                    onChange={e => { setEmailInput(e.target.value); setEmailError(null) }}
                    placeholder="nuevo@email.com"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Escape') cancelEditEmail() }}
                  />
                  <div className="rounded-xl border border-edge bg-secondary px-3 py-2">
                    <p className="text-sm text-body">
                      Se enviará un email de confirmación. El cambio no tendrá efecto hasta que lo confirmes.
                    </p>
                  </div>
                  {emailError && <p className="text-sm text-destructive">{emailError}</p>}
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={cancelEditEmail} disabled={emailSaving}>Cancelar</Button>
                    <Button size="sm" onClick={saveEmail} disabled={emailSaving || !emailInput.trim()}>
                      {emailSaving ? 'Enviando...' : 'Confirmar cambio'}
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-heading">{email}</span>
                <button type="button" onClick={() => setEditingEmail(true)} className="text-sm text-hint hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]">
                  Editar
                </button>
              </div>
            )}
          </div>

          {/* Password */}
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Contraseña</p>
            {editingPassword ? (
              pwSuccess ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3">
                    <p className="text-sm font-medium text-primary">
                      Contraseña actualizada correctamente
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={cancelEditPassword}>Cerrar</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-body">Contraseña actual</label>
                    <Input
                      type="password"
                      value={currentPw}
                      onChange={e => { setCurrentPw(e.target.value); setPwError(null) }}
                      placeholder="Contraseña actual"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Escape') cancelEditPassword() }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-body">Nueva contraseña</label>
                    <Input
                      type="password"
                      value={newPw}
                      onChange={e => { setNewPw(e.target.value); setPwError(null) }}
                      placeholder="Mínimo 8 caracteres"
                      onKeyDown={e => { if (e.key === 'Escape') cancelEditPassword() }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-body">Confirmar nueva contraseña</label>
                    <Input
                      type="password"
                      value={confirmPw}
                      onChange={e => { setConfirmPw(e.target.value); setPwError(null) }}
                      placeholder="Repite la nueva contraseña"
                      onKeyDown={e => { if (e.key === 'Enter') savePassword(); if (e.key === 'Escape') cancelEditPassword() }}
                    />
                  </div>
                  {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={cancelEditPassword} disabled={pwSaving}>Cancelar</Button>
                    <Button size="sm" onClick={savePassword} disabled={pwSaving}>
                      {pwSaving ? 'Guardando...' : 'Cambiar contraseña'}
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-hint">••••••••</span>
                <button type="button" onClick={() => setEditingPassword(true)} className="text-sm text-hint hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]">
                  Cambiar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Plan */}
        <div className="surface-elevated rounded-2xl divide-y divide-edge/40">
          <div className="px-5 py-4">
            <p className="text-xs text-hint mb-1.5 uppercase tracking-wide">Plan actual</p>
            <span className="text-sm font-medium text-heading capitalize">{business.plan}</span>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-hint">La gestión de facturación y cambios de plan estará disponible próximamente.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
