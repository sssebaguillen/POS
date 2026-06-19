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
import SelectDropdown from '@/components/ui/SelectDropdown'
import { Upload } from 'lucide-react'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { BUSINESS_SLUG_REGEX } from '@/lib/validation'
import { FieldErrorMessage, ShakeOnError } from '@/components/shared/ShakeError'
import { ERR } from '@/lib/errors'

interface SettingsFormProps {
  business: SettingsBusiness
  operators: SettingsOperator[]
  operatorId: string | null
  isOwner: boolean
  canManageOperators: boolean
  priceLists: { id: string; name: string; multiplier: number }[]
}

// Multiplicador base de la lista en formato compacto (ej. 1.3 → "×1.3", 1.305 → "×1.305").
function formatMultiplier(multiplier: number): string {
  return `×${parseFloat(multiplier.toFixed(4)).toString()}`
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
  freeLineEnabled: boolean
  aiInsightsEnabled: boolean
  catalogPriceListId: string
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
  operatorId,
  isOwner,
  canManageOperators,
  priceLists,
}: SettingsFormProps) {
  const priceListOptions = useMemo(
    () => [
      { value: '', label: 'Precio base (sin lista)' },
      ...priceLists.map(pl => ({ value: pl.id, label: `${pl.name} (${formatMultiplier(pl.multiplier)})` })),
    ],
    [priceLists],
  )
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
    freeLineEnabled: business.settings?.free_line_enabled === true,
    aiInsightsEnabled: business.settings?.ai_insights_enabled === true,
    catalogPriceListId: business.settings?.catalog_price_list_id ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [businessSlug, setBusinessSlug] = useState(business.slug)
  const [slugLoading, setSlugLoading] = useState(false)
  const [slugError, setSlugError] = useState('')
  const [slugErrorNonce, setSlugErrorNonce] = useState(0)
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
      setLogoUploadError(ERR.SET61)
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoUploadError(ERR.SET62)
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
      setLogoUploadError(ERR.SET6)
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
      // Refleja el toggle de IA proactiva sin esperar a la navegación.
      queryClient.invalidateQueries({ queryKey: ['ai_insights'] }),
    ])
    router.refresh()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = form.name.trim()
    if (!name) {
      setError(ERR.SET43)
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const { data: rpcResult, error: updateError } = await supabase.rpc('update_business_settings', {
        p_operator_id: operatorId,
        p_business_id: business.id,
        p_name: name,
        p_description: form.description.trim() || null,
        p_whatsapp: form.whatsapp.trim() || null,
        p_logo_url: normalizedLogoUrl || null,
        p_settings_patch: {
          primary_color: form.primaryColor,
          currency: form.currencyCode,
          free_line_enabled: form.freeLineEnabled,
          ai_insights_enabled: form.aiInsightsEnabled,
          catalog_price_list_id: form.catalogPriceListId || null,
        },
      })

      const result = rpcResult as { success: boolean; error?: string } | null

      if (updateError || !result?.success) {
        setError(result?.error ?? ERR.SET1)
        return
      }

      setSuccess('Configuración guardada.')
      await invalidateBusinessQueries()
    } catch {
      setError(ERR.SET1)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitCatalogPriceList() {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const { data: rpcResult, error: updateError } = await supabase.rpc('update_business_settings', {
        p_operator_id: operatorId,
        p_business_id: business.id,
        p_name: form.name.trim() || business.name,
        p_description: form.description.trim() || null,
        p_whatsapp: form.whatsapp.trim() || null,
        p_logo_url: normalizedLogoUrl || null,
        p_settings_patch: {
          primary_color: form.primaryColor,
          currency: form.currencyCode,
          free_line_enabled: form.freeLineEnabled,
          ai_insights_enabled: form.aiInsightsEnabled,
          catalog_price_list_id: form.catalogPriceListId || null,
        },
      })

      const result = rpcResult as { success: boolean; error?: string } | null

      if (updateError || !result?.success) {
        setError(result?.error ?? ERR.SET1)
        return
      }

      setSuccess('Lista de precios del catálogo actualizada.')
      await invalidateBusinessQueries()
    } catch {
      setError(ERR.SET1)
    } finally {
      setLoading(false)
    }
  }

  async function handleSlugSubmit() {
    const slug = normalizedBusinessSlug

    if (!BUSINESS_SLUG_REGEX.test(slug)) {
      setSlugError(ERR.SET41)
      setSlugErrorNonce(n => n + 1)
      setSlugSuccess('')
      return
    }

    setSlugLoading(true)
    setSlugError('')
    setSlugSuccess('')

    try {
      const { error: slugUpdateError } = await supabase.rpc('update_business_slug', {
        p_operator_id: operatorId,
        p_business_id: business.id,
        p_slug: slug,
      })

      if (slugUpdateError) {
        setSlugError(ERR.SET1)
        return
      }

      setSlugSuccess('URL del catálogo actualizada.')
      await invalidateBusinessQueries()
    } catch {
      setSlugError(ERR.SET1)
    } finally {
      setSlugLoading(false)
    }
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
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
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

              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Producto Libre en ventas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Permite agregar líneas de venta manuales sin producto registrado
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.freeLineEnabled}
                  onClick={() => setField('freeLineEnabled', !form.freeLineEnabled)}
                  className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ml-4 ${form.freeLineEnabled ? 'bg-primary' : 'bg-muted-foreground'}`}
                >
                  <span
                    className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${form.freeLineEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Sugerencias con IA</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Analiza tu negocio cada noche y te sugiere mejoras de precios, stock y más. Puedes descartar las que no te sirvan.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.aiInsightsEnabled}
                  onClick={() => setField('aiInsightsEnabled', !form.aiInsightsEnabled)}
                  className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ml-4 ${form.aiInsightsEnabled ? 'bg-primary' : 'bg-muted-foreground'}`}
                >
                  <span
                    className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${form.aiInsightsEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {/* Logo y Color primario — deshabilitados hasta implementación futura */}
              <div className="relative rounded-xl border border-dashed border-border overflow-hidden">
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 pointer-events-auto cursor-not-allowed" />
                <div className="absolute top-3 right-3 z-20">
                  <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    Próximamente
                  </span>
                </div>
                <div className="p-4 space-y-5 pointer-events-none select-none opacity-50">
                  <div className="space-y-1.5">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Logo</span>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="flex border-b border-border">
                        <button
                          type="button"
                          tabIndex={-1}
                          className="flex-1 px-4 py-2 text-xs font-medium bg-background text-foreground border-b-2 border-primary"
                        >
                          Subir archivo
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          className="flex-1 px-4 py-2 text-xs font-medium bg-muted/30 text-muted-foreground"
                        >
                          URL externa
                        </button>
                      </div>
                      <div className="p-3">
                        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5">
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Arrastra o haz clic para seleccionar</span>
                          <span className="text-[10px] text-muted-foreground">JPEG, PNG, WebP, SVG · máx. 2 MB</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Color primario
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg border border-input bg-[#7a3e10]" />
                      <span className="text-sm font-mono text-muted-foreground">#7a3e10</span>
                      <span className="text-xs text-muted-foreground ml-auto">Restablecer</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Se aplica a botones, badges y acentos del sistema.
                    </p>
                  </div>
                </div>
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
            <p className="text-sm text-muted-foreground mt-1">Configura la URL pública de tu catálogo de productos.</p>

            <div className="mt-6 space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="business-slug" className="text-xs uppercase tracking-wide text-muted-foreground">
                  URL de tu catálogo
                </label>
                <ShakeOnError error={slugError} nonce={slugErrorNonce}>
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
                    aria-invalid={!!slugError || undefined}
                  />
                </ShakeOnError>
                <p className="text-xs text-muted-foreground">
                  Vista previa: <span className="font-mono">{catalogPreviewUrl}</span>
                </p>
                {!isOwner && (
                  <p className="text-xs text-muted-foreground">Solo el owner puede cambiar esta URL.</p>
                )}
                <FieldErrorMessage error={slugError} />
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

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Lista de precios del catálogo
                </label>
                <SelectDropdown
                  value={form.catalogPriceListId}
                  onChange={value => setForm(prev => ({ ...prev, catalogPriceListId: value }))}
                  options={priceListOptions}
                  placeholder="Precio base (sin lista)"
                />
                <p className="text-xs text-muted-foreground">
                  Los precios del catálogo público se calcularán con el margen de la lista seleccionada. Si la lista se elimina, vuelve al precio base automáticamente.
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    className="h-9 px-4"
                    onClick={handleSubmitCatalogPriceList}
                    disabled={loading || form.catalogPriceListId === (business.settings?.catalog_price_list_id ?? '')}
                  >
                    {loading ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Operarios tab */}
        {activeTab === 'operarios' && (
          <OperatorList
            businessId={business.id}
            operatorId={operatorId}
            initialOperators={operators}
            isOwner={isOwner}
            canManageOperators={canManageOperators}
          />
        )}

      </div>
    </div>
  )
}
