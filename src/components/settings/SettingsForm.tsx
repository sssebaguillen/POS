'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isSettingsOperator, type OperatorRole, type SettingsBusiness, type SettingsOperator } from '@/components/settings/types'
import type { Permissions } from '@/lib/operator'

interface SettingsFormProps {
  business: SettingsBusiness
  operators: SettingsOperator[]
}

interface FormState {
  name: string
  description: string
  whatsapp: string
  logoUrl: string
  primaryColor: string
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default function SettingsForm({ business, operators }: SettingsFormProps) {
  const [form, setForm] = useState<FormState>({
    name: business.name,
    description: business.description ?? '',
    whatsapp: business.whatsapp ?? '',
    logoUrl: business.logo_url ?? '',
    primaryColor: business.settings?.primary_color ?? '#4f46e5',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [logoPreviewError, setLogoPreviewError] = useState(false)
  const [operatorList, setOperatorList] = useState<SettingsOperator[]>(operators)
  const [operatorName, setOperatorName] = useState('')
  const [operatorRole, setOperatorRole] = useState<OperatorRole>('cashier')
  const [operatorPin, setOperatorPin] = useState('')
  const [customPermissions, setCustomPermissions] = useState<Permissions>({
    sales: true,
    stock: true,
    stock_write: false,
    stats: false,
    price_lists: false,
    price_lists_write: false,
    settings: false,
  })
  const [operatorError, setOperatorError] = useState('')
  const [operatorSuccess, setOperatorSuccess] = useState('')
  const [operatorLoading, setOperatorLoading] = useState(false)
  const [deletingOperatorId, setDeletingOperatorId] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [copyError, setCopyError] = useState('')
  const copyTimeoutRef = useRef<number | null>(null)

  const supabase = createClient()

  const normalizedLogoUrl = form.logoUrl.trim()
  const hasLogoUrl = normalizedLogoUrl.length > 0
  const publicCatalogUrl = useMemo(
    () => `${typeof window !== 'undefined' ? window.location.origin : ''}/catalogo/${business.slug}`,
    [business.slug]
  )

  const canPreviewLogo = useMemo(() => {
    if (!hasLogoUrl) return false
    return isValidHttpUrl(normalizedLogoUrl)
  }, [hasLogoUrl, normalizedLogoUrl])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
    setSuccess('')

    if (field === 'logoUrl') {
      setLogoPreviewError(false)
    }
  }

  function normalizePin(value: string): string {
    return value.replace(/\D/g, '').slice(0, 4)
  }

  function roleLabel(role: OperatorRole): string {
    if (role === 'manager') return 'Manager'
    if (role === 'custom') return 'Custom'
    return 'Cashier'
  }

  async function refreshOperators() {
    const { data, error: operatorsError } = await supabase
      .from('operators')
      .select('id, name, role')
      .eq('business_id', business.id)
      .order('name')

    if (operatorsError) {
      setOperatorError(operatorsError.message)
      return
    }

    setOperatorList((data ?? []).filter(isSettingsOperator))
  }

  async function handleCreateOperator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = operatorName.trim()
    const normalizedPin = normalizePin(operatorPin)

    if (!trimmedName) {
      setOperatorError('El nombre del operador es obligatorio.')
      return
    }

    if (normalizedPin.length !== 4) {
      setOperatorError('El PIN debe contener 4 digitos numericos.')
      return
    }

    setOperatorLoading(true)
    setOperatorError('')
    setOperatorSuccess('')

    const { data: createData, error: createError } = await supabase.rpc('create_operator', {
      p_business_id: business.id,
      p_name: trimmedName,
      p_role: operatorRole,
      p_pin: normalizedPin,
      ...(operatorRole === 'custom' ? { p_permissions: customPermissions } : {}),
    })

    setOperatorLoading(false)

    if (createError || !createData?.success) {
      setOperatorError(createData?.error ?? createError?.message ?? 'Error al crear el operador.')
      return
    }

    setOperatorName('')
    setOperatorRole('cashier')
    setOperatorPin('')
    setCustomPermissions({
      sales: true,
      stock: true,
      stock_write: false,
      stats: false,
      price_lists: false,
      price_lists_write: false,
      settings: false,
    })
    setOperatorSuccess('Operador creado correctamente.')
    await refreshOperators()
  }

  async function handleDeleteOperator(operator: SettingsOperator) {
    const confirmed = window.confirm(`Eliminar operador ${operator.name}?`)
    if (!confirmed) {
      return
    }

    setDeletingOperatorId(operator.id)
    setOperatorError('')
    setOperatorSuccess('')

    const { error: deleteError } = await supabase
      .from('operators')
      .delete()
      .eq('id', operator.id)
      .eq('business_id', business.id)

    setDeletingOperatorId(null)

    if (deleteError) {
      setOperatorError(deleteError.message)
      return
    }

    setOperatorSuccess('Operador eliminado correctamente.')
    setOperatorList(prev => prev.filter(item => item.id !== operator.id))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = form.name.trim()
    if (!name) {
      setError('El nombre del negocio es obligatorio.')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    const { error: updateError } = await supabase
      .from('businesses')
      .update({
        name,
        description: form.description.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        logo_url: normalizedLogoUrl || null,
        settings: {
          ...(business.settings ?? {}),
          primary_color: form.primaryColor,
        },
      })
      .eq('id', business.id)

    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess('Configuración guardada. Aplicando cambios...')
    setTimeout(() => {
      window.location.reload()
    }, 800)
  }

  async function handleCopyPublicUrl() {
    setCopyError('')

    try {
      await navigator.clipboard.writeText(publicCatalogUrl)
      setCopySuccess(true)

      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current)
      }

      copyTimeoutRef.current = window.setTimeout(() => {
        setCopySuccess(false)
        copyTimeoutRef.current = null
      }, 2000)
    } catch (copyUnknownError: unknown) {
      const message = copyUnknownError instanceof Error ? copyUnknownError.message : 'No se pudo copiar el enlace.'
      setCopyError(message)
      setCopySuccess(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl bg-card border border-border/60 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Negocio</h2>
        <p className="text-sm text-muted-foreground mt-1">Actualizá los datos visibles en el sistema y el catálogo público.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="business-name" className="text-xs uppercase tracking-wide text-muted-foreground">
            Nombre
          </label>
          <Input
            id="business-name"
            value={form.name}
            onChange={event => setField('name', event.target.value)}
            placeholder="Nombre del negocio"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="business-description" className="text-xs uppercase tracking-wide text-muted-foreground">
            Descripción
          </label>
          <textarea
            id="business-description"
            value={form.description}
            onChange={event => setField('description', event.target.value)}
            placeholder="Descripción opcional para el catálogo"
            rows={4}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="business-whatsapp" className="text-xs uppercase tracking-wide text-muted-foreground">
            WhatsApp
          </label>
          <Input
            id="business-whatsapp"
            value={form.whatsapp}
            onChange={event => setField('whatsapp', event.target.value)}
            placeholder="5491112345678"
          />
          <p className="text-xs text-muted-foreground">
            Include country and area code, numbers only. E.g.: 5491112345678
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="business-logo-url" className="text-xs uppercase tracking-wide text-muted-foreground">
            URL del logo
          </label>
          <Input
            id="business-logo-url"
            value={form.logoUrl}
            onChange={event => setField('logoUrl', event.target.value)}
            placeholder="https://..."
          />

          {hasLogoUrl && !canPreviewLogo && (
            <p className="text-xs text-destructive">Ingresá una URL válida con http:// o https://.</p>
          )}

          {canPreviewLogo && !logoPreviewError && (
            <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <img
                src={normalizedLogoUrl}
                alt="Vista previa del logo"
                className="h-12 w-12 rounded-md object-cover border border-border"
                onError={() => setLogoPreviewError(true)}
              />
              <span className="text-xs text-muted-foreground">Vista previa del logo</span>
            </div>
          )}

          {canPreviewLogo && logoPreviewError && (
            <p className="text-xs text-destructive">No se pudo cargar la imagen desde esa URL.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="public-catalog-url" className="text-xs uppercase tracking-wide text-muted-foreground">
            URL publica del catalogo
          </label>
          <div className="flex gap-2">
            <Input id="public-catalog-url" value={publicCatalogUrl} readOnly disabled />
            <Button type="button" variant="outline" className="shrink-0" onClick={handleCopyPublicUrl}>
              Copiar enlace
            </Button>
          </div>
          {copySuccess && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">¡Enlace copiado!</p>}
          {copyError && <p className="text-xs text-destructive">{copyError}</p>}
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Color primario
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.primaryColor}
              onChange={e => setField('primaryColor', e.target.value)}
              className="h-10 w-10 rounded-lg border border-input cursor-pointer bg-transparent p-0.5"
            />
            <span className="text-sm font-mono text-muted-foreground">
              {form.primaryColor}
            </span>
            <button
              type="button"
              onClick={() => setField('primaryColor', '#4f46e5')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              Restablecer
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Se aplica a botones, badges y acentos del sistema.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {success && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
            {success}
          </p>
        )}

          <div className="flex justify-end">
            <Button type="submit" className="h-9 px-4" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </div>

      <div className="rounded-xl bg-card border border-border/60 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Operadores</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Crea subusuarios con PIN de 4 digitos para cambiar el operador activo durante el turno.
        </p>

        <div className="mt-5 space-y-2">
          {operatorList.map(operator => (
            <div
              key={operator.id}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{operator.name}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{roleLabel(operator.role)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3 text-xs"
                disabled={deletingOperatorId === operator.id}
                onClick={() => handleDeleteOperator(operator)}
              >
                {deletingOperatorId === operator.id ? 'Eliminando...' : 'Eliminar'}
              </Button>
            </div>
          ))}
        </div>

        <form onSubmit={handleCreateOperator} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="operator-name" className="text-xs uppercase tracking-wide text-muted-foreground">
              Nombre
            </label>
            <Input
              id="operator-name"
              value={operatorName}
              onChange={event => {
                setOperatorName(event.target.value)
                setOperatorError('')
                setOperatorSuccess('')
              }}
              placeholder="Nombre del operador"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="operator-role" className="text-xs uppercase tracking-wide text-muted-foreground">
              Rol
            </label>
            <select
              id="operator-role"
              value={operatorRole}
              onChange={event => {
                setOperatorRole(event.target.value as OperatorRole)
                setOperatorError('')
                setOperatorSuccess('')
              }}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {operatorRole === 'custom' && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Permisos</p>
              <div className="rounded-lg border border-border/60 divide-y divide-border/60">
                {(
                  [
                    { key: 'sales', label: 'Ventas' },
                    { key: 'stock', label: 'Ver inventario' },
                    { key: 'stock_write', label: 'Modificar inventario' },
                    { key: 'stats', label: 'Estadísticas' },
                    { key: 'price_lists', label: 'Ver listas de precios' },
                    { key: 'price_lists_write', label: 'Modificar listas de precios' },
                    { key: 'settings', label: 'Configuración' },
                  ] as { key: keyof Permissions; label: string }[]
                ).map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-sm text-foreground">{label}</span>
                    <input
                      type="checkbox"
                      checked={customPermissions[key]}
                      onChange={e =>
                        setCustomPermissions(prev => ({ ...prev, [key]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="operator-pin" className="text-xs uppercase tracking-wide text-muted-foreground">
              PIN
            </label>
            <Input
              id="operator-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={operatorPin}
              onChange={event => {
                setOperatorPin(normalizePin(event.target.value))
                setOperatorError('')
                setOperatorSuccess('')
              }}
              placeholder="4 digitos"
              required
            />
          </div>

          {operatorError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {operatorError}
            </p>
          )}

          {operatorSuccess && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400">
              {operatorSuccess}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" className="h-9 px-4" disabled={operatorLoading}>
              {operatorLoading ? 'Creando...' : 'Agregar operador'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}