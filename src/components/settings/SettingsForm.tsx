'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Image from 'next/image'
import { type SettingsBusiness, type SettingsOperator } from '@/components/settings/types'
import OperatorList from '@/components/settings/OperatorList'
import { CURRENCIES, type SupportedCurrencyCode } from '@/lib/constants/currencies'
import { Upload } from 'lucide-react'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { BUSINESS_SLUG_REGEX } from '@/lib/validation'

interface SettingsFormProps {
  business: SettingsBusiness
  operators: SettingsOperator[]
  isOwner: boolean
  canManageOperators: boolean
}

const LOGO_ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/svg+xml',
])

const LOGO_MAX_BYTES = 2 * 1024 * 1024

interface FormState {
  name: string
  description: string
  whatsapp: string
  logoUrl: string
  primaryColor: string
  currencyCode: SupportedCurrencyCode
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

type SettingsTab = 'negocio' | 'catalogo' | 'operarios'

const ALL_TABS: { key: SettingsTab; label: string; ownerOnly: boolean }[] = [
  { key: 'negocio', label: 'Negocio', ownerOnly: true },
  { key: 'catalogo', label: 'Catálogo', ownerOnly: true },
  { key: 'operarios', label: 'Operarios', ownerOnly: false },
]

const SUCCESS_CLASS =
  'rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400'

export default function SettingsForm({
  business,
  operators,
  isOwner,
  canManageOperators,
}: SettingsFormProps) {
  const initialCurrency = (() => {
    const raw = business.settings?.currency
    if (typeof raw === 'string' && CURRENCIES.some(c => c.code === raw)) {
      return raw as SupportedCurrencyCode
    }
    return 'ARS'
  })()

  const visibleTabs = ALL_TABS.filter(t => !t.ownerOnly || isOwner)

  const [activeTab, setActiveTab] = useState<SettingsTab>(isOwner ? 'negocio' : 'operarios')
  const { setRef, indicator } = usePillIndicator(activeTab)

  const [form, setForm] = useState<FormState>({
    name: business.name,
    description: business.description ?? '',
    whatsapp: business.whatsapp ?? '',
    logoUrl: business.logo_url ?? '',
    primaryColor: business.settings?.primary_color ?? '#7a3e10',
    currencyCode: initialCurrency,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [businessSlug, setBusinessSlug] = useState(business.slug)
  const [slugLoading, setSlugLoading] = useState(false)
  const [slugError, setSlugError] = useState('')
  const [slugSuccess, setSlugSuccess] = useState('')
  const [logoPreviewError, setLogoPreviewError] = useState(false)
  const [logoInputTab, setLogoInputTab] = useState<'upload' | 'url'>('url')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoUploadError, setLogoUploadError] = useState('')
  const [currencyInput, setCurrencyInput] = useState('')
  const [showCurrencyOptions, setShowCurrencyOptions] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [copyError, setCopyError] = useState('')
  const copyTimeoutRef = useRef<number | null>(null)
  const router = useRouter()
  const queryClient = useQueryClient()

  const supabase = useMemo(() => createClient(), [])

  const normalizedLogoUrl = form.logoUrl.trim()
  const normalizedBusinessSlug = businessSlug.trim()
  const hasLogoUrl = normalizedLogoUrl.length > 0
  const publicCatalogUrl = useMemo(
    () => `${typeof window !== 'undefined' ? window.location.origin : ''}/catalogo/${normalizedBusinessSlug}`,
    [normalizedBusinessSlug]
  )
  const catalogPreviewUrl = useMemo(
    () => `puls.ar/${normalizedBusinessSlug}`,
    [normalizedBusinessSlug]
  )

  const canPreviewLogo = useMemo(() => {
    if (!hasLogoUrl) return false
    return isValidHttpUrl(normalizedLogoUrl)
  }, [hasLogoUrl, normalizedLogoUrl])

  const filteredCurrencies = useMemo(() => {
    const q = currencyInput.trim().toLowerCase()
    if (!q) return [...CURRENCIES]
    return CURRENCIES.filter(
      c => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    )
  }, [currencyInput])

  const selectedCurrencyLabel = useMemo(
    () => CURRENCIES.find(c => c.code === form.currencyCode)?.label ?? '',
    [form.currencyCode]
  )

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

  async function handleLogoFileUpload(file: File) {
    setLogoUploadError('')
    if (!LOGO_ALLOWED_TYPES.has(file.type)) {
      setLogoUploadError('Formato no permitido. Usá JPEG, PNG, WebP o SVG.')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoUploadError('El archivo supera el máximo de 2 MB.')
      return
    }

    setLogoUploading(true)
    const extFromName = file.name.split('.').pop()?.toLowerCase()
    const ext =
      extFromName && /^[a-z0-9]{1,8}$/.test(extFromName)
        ? extFromName
        : file.type === 'image/png'
          ? 'png'
          : file.type === 'image/webp'
            ? 'webp'
            : file.type === 'image/svg+xml'
              ? 'svg'
              : 'jpg'

    const path = `${business.id}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage.from('business-logos').upload(path, file, {
      upsert: true,
      contentType: file.type,
    })

    if (uploadError) {
      setLogoUploadError(uploadError.message)
      setLogoUploading(false)
      return
    }

    const { data: urlData } = supabase.storage.from('business-logos').getPublicUrl(path)
    setField('logoUrl', urlData.publicUrl)
    setLogoUploading(false)
  }

  async function invalidateBusinessQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['business'] }),
    ])
    router.refresh()
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
          ...(business.settings as Record<string, unknown> | null | undefined),
          primary_color: form.primaryColor,
          currency: form.currencyCode,
        },
      })
      .eq('id', business.id)

    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setSuccess('Configuración guardada.')
    await invalidateBusinessQueries()
  }

  async function handleSlugSubmit() {
    const slug = normalizedBusinessSlug

    if (!BUSINESS_SLUG_REGEX.test(slug)) {
      setSlugError('El slug debe usar solo letras minúsculas, números o guiones, y tener entre 3 y 50 caracteres.')
      setSlugSuccess('')
      return
    }

    setSlugLoading(true)
    setSlugError('')
    setSlugSuccess('')

    const { error: slugUpdateError } = await supabase.rpc('update_business_slug', { p_slug: slug })

    setSlugLoading(false)

    if (slugUpdateError) {
      setSlugError(slugUpdateError.message)
      return
    }

    setSlugSuccess('URL del catálogo actualizada.')
    await invalidateBusinessQueries()
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
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab strip */}
      <div className="shrink-0 border-b border-edge px-6 pt-3 pb-3 flex items-center justify-center">
        <div className="pill-tabs relative">
          {indicator && (
            <span
              className="pill-tab-indicator"
              style={{
                transform: `translateX(${indicator.left}px)`,
                width: indicator.width,
              }}
            />
          )}
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              ref={setRef(tab.key)}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`pill-tab !px-8${activeTab === tab.key ? ' pill-tab-active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Negocio tab */}
        {activeTab === 'negocio' && (
          <div className="surface-card p-6 max-w-3xl mx-auto w-full">
            <h2 className="text-base font-semibold text-foreground font-display">Negocio</h2>
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
                  Incluí el código de país y área, solo números. Ej.: 5491112345678
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Moneda</label>
                <div className="relative">
                  <Input
                    id="business-currency"
                    value={currencyInput || form.currencyCode}
                    onFocus={() => setShowCurrencyOptions(true)}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setShowCurrencyOptions(false)
                        setCurrencyInput('')
                      }, 120)
                    }}
                    onChange={event => {
                      const next = event.target.value
                      setCurrencyInput(next)
                      setShowCurrencyOptions(true)
                      const exact = CURRENCIES.find(
                        c => c.code.toLowerCase() === next.trim().toLowerCase()
                      )
                      if (exact) {
                        setForm(prev => ({ ...prev, currencyCode: exact.code }))
                      }
                    }}
                    placeholder="Seleccionar moneda"
                    className="font-mono"
                    autoComplete="off"
                  />
                  {showCurrencyOptions && (
                    <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
                      {filteredCurrencies.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</div>
                      ) : (
                        filteredCurrencies.map(c => (
                          <button
                            key={c.code}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
                            onMouseDown={event => {
                              event.preventDefault()
                              setForm(prev => ({ ...prev, currencyCode: c.code }))
                              setCurrencyInput('')
                              setShowCurrencyOptions(false)
                            }}
                          >
                            {c.code} — {c.label}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selectedCurrencyLabel && (
                  <p className="text-xs text-muted-foreground">{selectedCurrencyLabel}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Logo</span>
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="flex border-b border-border">
                    <button
                      type="button"
                      onClick={() => {
                        setLogoInputTab('upload')
                        setLogoUploadError('')
                      }}
                      className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                        logoInputTab === 'upload'
                          ? 'bg-background text-foreground border-b-2 border-primary'
                          : 'bg-muted/30 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Subir archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLogoInputTab('url')
                        setLogoUploadError('')
                      }}
                      className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                        logoInputTab === 'url'
                          ? 'bg-background text-foreground border-b-2 border-primary'
                          : 'bg-muted/30 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      URL externa
                    </button>
                  </div>
                  <div className="p-3 space-y-3">
                    {logoInputTab === 'upload' && (
                      <>
                        <label className="flex flex-col items-center gap-2 cursor-pointer rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 hover:border-primary/40 transition-colors">
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {logoUploading ? 'Subiendo...' : 'Arrastrá o hacé clic para seleccionar'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            JPEG, PNG, WebP, SVG · máx. 2 MB
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/jpg,image/png,image/webp,image/svg+xml"
                            className="sr-only"
                            disabled={logoUploading}
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) void handleLogoFileUpload(file)
                              e.target.value = ''
                            }}
                          />
                        </label>
                        {logoUploadError && <p className="text-xs text-destructive">{logoUploadError}</p>}
                      </>
                    )}
                    {logoInputTab === 'url' && (
                      <Input
                        id="business-logo-url"
                        value={form.logoUrl}
                        onChange={event => setField('logoUrl', event.target.value)}
                        placeholder="https://..."
                      />
                    )}
                  </div>
                </div>

                {hasLogoUrl && !canPreviewLogo && logoInputTab === 'url' && (
                  <p className="text-xs text-destructive">Ingresá una URL válida con http:// o https://.</p>
                )}

                {hasLogoUrl && canPreviewLogo && !logoPreviewError && (
                  <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <Image
                      src={normalizedLogoUrl}
                      alt="Vista previa del logo"
                      width={48}
                      height={48}
                      className="rounded-md object-cover border border-border"
                      onError={() => setLogoPreviewError(true)}
                      unoptimized
                    />
                    <span className="text-xs text-muted-foreground">Vista previa del logo</span>
                  </div>
                )}

                {canPreviewLogo && logoPreviewError && (
                  <p className="text-xs text-destructive">No se pudo cargar la imagen desde esa URL.</p>
                )}
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
                    onClick={() => setField('primaryColor', '#7a3e10')}
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

              {success && <p className={SUCCESS_CLASS}>{success}</p>}

              <div className="flex justify-end">
                <Button type="submit" className="h-9 px-4" disabled={loading}>
                  {loading ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Catálogo tab */}
        {activeTab === 'catalogo' && (
          <div className="surface-card p-6 max-w-3xl mx-auto w-full">
            <h2 className="text-base font-semibold text-foreground font-display">Catálogo</h2>
            <p className="text-sm text-muted-foreground mt-1">Configurá la URL pública de tu catálogo de productos.</p>

            <div className="mt-6 space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="business-slug" className="text-xs uppercase tracking-wide text-muted-foreground">
                  URL de tu catálogo
                </label>
                <Input
                  id="business-slug"
                  value={businessSlug}
                  onChange={event => {
                    setBusinessSlug(event.target.value)
                    setSlugError('')
                    setSlugSuccess('')
                  }}
                  placeholder="mi-negocio"
                  disabled={!isOwner || slugLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Vista previa: <span className="font-mono">{catalogPreviewUrl}</span>
                </p>
                {!isOwner && (
                  <p className="text-xs text-muted-foreground">Solo el owner puede cambiar esta URL.</p>
                )}
                {slugError && <p className="text-xs text-destructive">{slugError}</p>}
                {slugSuccess && <p className={SUCCESS_CLASS}>{slugSuccess}</p>}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    className="h-9 px-4"
                    onClick={handleSlugSubmit}
                    disabled={!isOwner || slugLoading || normalizedBusinessSlug === business.slug}
                  >
                    {slugLoading ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="public-catalog-url" className="text-xs uppercase tracking-wide text-muted-foreground">
                  URL pública del catálogo
                </label>
                <div className="flex gap-2">
                  <Input id="public-catalog-url" value={publicCatalogUrl} readOnly disabled />
                  <Button type="button" variant="outline" className="shrink-0" onClick={handleCopyPublicUrl}>
                    Copiar enlace
                  </Button>
                </div>
                {copySuccess && <p className={SUCCESS_CLASS}>¡Enlace copiado!</p>}
                {copyError && <p className="text-xs text-destructive">{copyError}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Operarios tab */}
        {activeTab === 'operarios' && (
          <OperatorList
            businessId={business.id}
            initialOperators={operators}
            isOwner={isOwner}
            canManageOperators={canManageOperators}
          />
        )}

      </div>
    </div>
  )
}
