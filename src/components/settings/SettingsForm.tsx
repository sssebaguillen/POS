'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SettingsBusiness {
  id: string
  name: string
  description: string | null
  whatsapp: string | null
  logo_url: string | null
}

interface SettingsFormProps {
  business: SettingsBusiness
}

interface FormState {
  name: string
  description: string
  whatsapp: string
  logoUrl: string
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export default function SettingsForm({ business }: SettingsFormProps) {
  const [form, setForm] = useState<FormState>({
    name: business.name,
    description: business.description ?? '',
    whatsapp: business.whatsapp ?? '',
    logoUrl: business.logo_url ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [logoPreviewError, setLogoPreviewError] = useState(false)

  const supabase = createClient()

  const normalizedLogoUrl = form.logoUrl.trim()
  const hasLogoUrl = normalizedLogoUrl.length > 0

  const canPreviewLogo = useMemo(() => {
    if (!hasLogoUrl) return false
    return isValidHttpUrl(normalizedLogoUrl)
  }, [hasLogoUrl, normalizedLogoUrl])

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
    setSuccess('')

    if (field === 'logoUrl') {
      setLogoPreviewError(false)
    }
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
      })
      .eq('id', business.id)

    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess('Configuración guardada correctamente.')
  }

  return (
    <div className="rounded-xl bg-card border border-border/60 p-6 shadow-sm max-w-3xl">
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

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {success && (
          <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
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
  )
}