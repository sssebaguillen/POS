'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import NewProductModal from '@/components/inventory/NewProductModal'
import NewOperatorModal from '@/components/settings/NewOperatorModal'
import { CURRENCIES, type SupportedCurrencyCode } from '@/lib/constants/currencies'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import {
  mergeOnboardingState,
  parseOnboardingState,
  type OnboardingState,
} from '@/components/onboarding/onboarding-types'
import { CATEGORY_ICONS, ICON_COLOR_PRESETS } from '@/components/inventory/IconPickerPanel'
import { DynamicIcon } from '@/components/inventory/CategoryIconPreview'
import { cn } from '@/lib/utils'

const DEFAULT_ICON = 'Package'
const DEFAULT_COLOR = '#7a3e10'
const FINAL_WIZARD_STEP = 5

export interface OnboardingWizardProfile {
  id: string
  role: string
  onboarding_state: Record<string, unknown> | null
}

interface CategoryRow {
  id: string
  name: string
  icon: string
}

interface OnboardingWizardProps {
  profile: OnboardingWizardProfile
  businessId: string
  initialBusinessName: string
  initialBusinessSettings: Record<string, unknown> | null
  initialCurrency: SupportedCurrencyCode
  operatorId: string | null
  stockWriteAllowed: boolean
  priceLists: PriceList[]
  categories: CategoryRow[]
  brands: InventoryBrand[]
  onFinishedWizard: () => void
}

export default function OnboardingWizard({
  profile,
  businessId,
  initialBusinessName,
  initialBusinessSettings,
  initialCurrency,
  operatorId,
  stockWriteAllowed,
  priceLists,
  categories: initialCategories,
  brands: initialBrands,
  onFinishedWizard,
}: OnboardingWizardProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const initialOnboarding = useMemo(
    () => parseOnboardingState(profile.onboarding_state),
    [profile.onboarding_state]
  )

  const onboardingRef = useRef<OnboardingState>(initialOnboarding)
  const skipFirstPersist = useRef(true)
  const finalizingRef = useRef(false)

  useEffect(() => {
    onboardingRef.current = parseOnboardingState(profile.onboarding_state)
  }, [profile.onboarding_state])

  const [step, setStep] = useState(() =>
    Math.min(Math.max(initialOnboarding.wizard_step, 0), FINAL_WIZARD_STEP - 1)
  )
  const [stepsDone, setStepsDone] = useState<string[]>(() => initialOnboarding.steps_done ?? [])

  const [bizName, setBizName] = useState(initialBusinessName)
  const [currencyCode, setCurrencyCode] = useState<SupportedCurrencyCode>(initialCurrency)
  const [currencyInput, setCurrencyInput] = useState('')
  const [showCurrencyOptions, setShowCurrencyOptions] = useState(false)
  const [step0Error, setStep0Error] = useState('')

  const [categoryName, setCategoryName] = useState('')
  const [categoryIcon, setCategoryIcon] = useState<string>(DEFAULT_ICON)
  const [categoryColor, setCategoryColor] = useState<string>(DEFAULT_COLOR)
  const [iconSearch, setIconSearch] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)
  const [categories, setCategories] = useState<CategoryRow[]>(initialCategories)
  const [brandName, setBrandName] = useState('')
  const [brandError, setBrandError] = useState<string | null>(null)
  const [brandSaving, setBrandSaving] = useState(false)
  const [brands, setBrands] = useState<InventoryBrand[]>(initialBrands)

  const filteredCurrencies = useMemo(() => {
    const q = currencyInput.trim().toLowerCase()
    if (!q) return [...CURRENCIES]
    return CURRENCIES.filter(
      c => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    )
  }, [currencyInput])
  const selectedCurrency = useMemo(
    () => CURRENCIES.find(c => c.code === currencyCode) ?? null,
    [currencyCode]
  )

  const persistPartial = useCallback(
    async (patch: Partial<OnboardingState>) => {
      const next = mergeOnboardingState(onboardingRef.current, patch)
      onboardingRef.current = next
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_state: next })
        .eq('id', profile.id)
      if (error) {
        console.error('Onboarding persist failed', error.message)
        return
      }
      router.refresh()
    },
    [profile.id, router, supabase]
  )

  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false
      return
    }
    if (finalizingRef.current) return
    void persistPartial({ wizard_step: step, steps_done: stepsDone })
  }, [step, stepsDone, persistPartial])

  function withStepDone(id: string): string[] {
    if (stepsDone.includes(id)) {
      return stepsDone
    }
    const next = [...stepsDone, id]
    setStepsDone(next)
    return next
  }

  async function handleStep0Next() {
    const name = bizName.trim()
    if (!name) {
      setStep0Error('El nombre del negocio es obligatorio.')
      return
    }
    setStep0Error('')
    const { error } = await supabase
      .from('businesses')
      .update({
        name,
        settings: {
          ...(initialBusinessSettings ?? {}),
          currency: currencyCode,
        },
      })
      .eq('id', businessId)

    if (error) {
      setStep0Error(error.message)
      return
    }

    withStepDone('business_info')
    setStep(1)
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault()
    if (!stockWriteAllowed || !operatorId) {
      setCategoryError('No hay sesión de operador o permisos insuficientes para crear categorías.')
      return
    }
    const trimmed = categoryName.trim()
    if (!trimmed) {
      setCategoryError('El nombre es obligatorio')
      return
    }
    setCategorySaving(true)
    setCategoryError(null)
    const iconValue = categoryIcon.trim() || DEFAULT_ICON
    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_category_guarded', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_name: trimmed,
      p_icon: iconValue,
      p_icon_color: categoryColor,
    })
    const result = rpcResult as { success: boolean; error?: string; id?: string } | null
    if (rpcError || !result?.success) {
      setCategoryError(result?.error ?? rpcError?.message ?? 'Error al crear la categoría')
      setCategorySaving(false)
      return
    }
    const createdId = typeof result.id === 'string' ? result.id : null
    withStepDone('category')
    setCategoryName('')
    setCategoryIcon(DEFAULT_ICON)
    setCategoryColor(DEFAULT_COLOR)
    setIconSearch('')
    if (createdId) setCategories(prev => [...prev, { id: createdId, name: trimmed, icon: iconValue }])
    setCategorySaving(false)
    setStep(2)
  }

  async function handleCreateBrand(e: React.FormEvent) {
    e.preventDefault()
    if (!stockWriteAllowed || !operatorId) {
      setBrandError('No hay sesión de operador o permisos insuficientes para crear marcas.')
      return
    }
    const trimmed = brandName.trim()
    if (!trimmed) {
      setBrandError('El nombre es obligatorio')
      return
    }
    setBrandSaving(true)
    setBrandError(null)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_brand_guarded', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_name: trimmed,
    })
    const result = rpcResult as { success: boolean; error?: string; id?: string } | null
    if (rpcError || !result?.success) {
      setBrandError(result?.error ?? rpcError?.message ?? 'Error al crear la marca')
      setBrandSaving(false)
      return
    }

    const createdId = typeof result.id === 'string' ? result.id : null
    let nextBrand: InventoryBrand | null = null
    if (createdId) {
      const { data: row } = await supabase
        .from('brands')
        .select('id, name')
        .eq('id', createdId)
        .single()
      if (row) {
        nextBrand = { id: row.id, name: row.name }
      }
    }

    withStepDone('brand')
    setBrandName('')
    if (nextBrand) {
      setBrands(prev =>
        prev.some(brand => brand.id === nextBrand.id)
          ? prev
          : [...prev, nextBrand].sort((a, b) => a.name.localeCompare(b.name))
      )
    }
    setBrandSaving(false)
    setStep(3)
  }

  async function handleDefer() {
    const next = mergeOnboardingState(onboardingRef.current, {
      completed: false,
      wizard_step: step,
      steps_done: stepsDone,
      tour_done: false,
      wizard_suppressed: true,
    })
    onboardingRef.current = next
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_state: next })
      .eq('id', profile.id)
    if (error) {
      console.error('Onboarding defer failed', error.message)
      return
    }
    window.dispatchEvent(new Event('onboarding-state-changed'))
    router.refresh()
  }

  async function handleFinalize(stepsDoneOverride?: string[]) {
    finalizingRef.current = true
    const finalStepsDone = stepsDoneOverride ?? stepsDone
    const next = mergeOnboardingState(onboardingRef.current, {
      completed: false,
      wizard_step: FINAL_WIZARD_STEP,
      steps_done: finalStepsDone,
      tour_done: false,
      wizard_suppressed: false,
    })
    onboardingRef.current = next
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_state: next })
      .eq('id', profile.id)
    if (error) {
      console.error('Onboarding finalize failed', error.message)
      return
    }
    window.dispatchEvent(new Event('onboarding-state-changed'))
    router.refresh()
    onFinishedWizard()
  }

  return (
    <Dialog open={true} modal onOpenChange={() => { /* non-dismissible */ }}>
      <DialogContent
        className="sm:max-w-[640px] p-0 gap-0 overflow-visible bg-card max-h-[90vh] flex flex-col"
        showCloseButton={false}
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Configuración inicial</DialogTitle>
        <div className="border-b border-edge px-5 py-4 shrink-0">
          <h2 className="text-base font-semibold text-heading">Configurá tu negocio</h2>
          <p className="text-xs text-subtle mt-1">
            {step === 0 && 'Datos básicos'}
            {step === 1 && 'Primera categoría'}
            {step === 2 && 'Primera marca'}
            {step === 3 && 'Primer producto'}
            {step === 4 && 'Primer operador'}
          </p>
        </div>

        <div
          className={`flex-1 min-h-0 px-5 py-4 ${
            step === 0 ? 'overflow-visible' : 'overflow-y-auto'
          }`}
        >
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-label text-subtle">Nombre del negocio</label>
                <Input
                  value={bizName}
                  onChange={e => {
                    setBizName(e.target.value)
                    setStep0Error('')
                  }}
                  className="h-9 rounded-xl text-sm bg-surface border-edge"
                  placeholder="Mi negocio"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-label text-subtle">Moneda</label>
                <div className="relative">
                  <Input
                    value={
                      currencyInput !== ''
                        ? currencyInput
                        : selectedCurrency
                          ? `${selectedCurrency.code} — ${selectedCurrency.label}`
                          : currencyCode
                    }
                    onFocus={() => {
                      setCurrencyInput('')
                      setShowCurrencyOptions(true)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setShowCurrencyOptions(false)
                        setCurrencyInput('')
                      }, 120)
                    }}
                    onChange={e => {
                      const next = e.target.value
                      setCurrencyInput(next)
                      setShowCurrencyOptions(true)
                    }}
                    placeholder="Buscar moneda..."
                    className="h-9 rounded-xl text-sm bg-surface border-edge"
                    autoComplete="off"
                  />
                  {showCurrencyOptions && (
                    <div className="absolute z-20 top-full mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-edge surface-elevated">
                      {filteredCurrencies.map(c => (
                        <button
                          key={c.code}
                          type="button"
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-hover-bg transition-colors flex items-center justify-between ${
                            c.code === currencyCode ? 'text-primary font-medium' : 'text-body'
                          }`}
                          onMouseDown={ev => {
                            ev.preventDefault()
                            setCurrencyCode(c.code)
                            setCurrencyInput('')
                            setShowCurrencyOptions(false)
                          }}
                        >
                          <span>{c.code} — {c.label}</span>
                          <span className="text-hint text-xs ml-2">{c.symbol}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-hint">
                  {selectedCurrency ? `Símbolo: ${selectedCurrency.symbol}` : ''}
                </p>
              </div>
              {step0Error && (
                <p className="text-sm text-destructive border border-destructive/30 rounded-lg px-3 py-2 bg-destructive/5">
                  {step0Error}
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <form id="onboarding-category-form" onSubmit={handleCreateCategory} className="space-y-4">
              <p className="text-sm text-subtle">Creá una categoría para organizar tus productos (opcional).</p>
              <div className="space-y-1.5">
                <label className="text-label text-subtle">Nombre</label>
                <Input
                  value={categoryName}
                  onChange={e => {
                    setCategoryName(e.target.value)
                    setCategoryError(null)
                  }}
                  className="h-9 rounded-xl text-sm bg-surface border-edge"
                  placeholder="Ej: Bebidas"
                />
              </div>
              <div className="space-y-2">
                <p className="text-label text-subtle">Icono</p>
                <Input
                  value={iconSearch}
                  onChange={e => setIconSearch(e.target.value)}
                  placeholder="Buscar icono…"
                  className="h-8 text-sm bg-surface border-edge"
                />
                <div className="max-h-44 overflow-y-auto rounded-xl border border-edge/60 bg-surface p-2">
                  <div className="grid grid-cols-6 gap-1.5">
                    {CATEGORY_ICONS.filter(i =>
                      !iconSearch.trim() || i.label.toLowerCase().includes(iconSearch.toLowerCase())
                    ).map(({ name, label }) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setCategoryIcon(name)}
                        className={cn(
                          'flex flex-col items-center justify-center gap-1 rounded-lg p-1.5 h-14',
                          'border transition-colors hover:bg-accent',
                          categoryIcon === name ? 'border-2 bg-accent/60' : 'border-transparent',
                        )}
                        style={categoryIcon === name ? { borderColor: categoryColor } : undefined}
                        aria-label={label}
                      >
                        <DynamicIcon name={name} size={20} color={categoryColor} />
                        <span className="text-[9px] text-subtle leading-tight truncate w-full text-center">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-label text-subtle">Color del icono</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {ICON_COLOR_PRESETS.map(hex => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setCategoryColor(hex)}
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all hover:scale-110',
                        categoryColor === hex ? 'scale-110 border-heading' : 'border-transparent',
                      )}
                      style={{ backgroundColor: hex }}
                      aria-label={hex}
                    />
                  ))}
                  <input
                    type="color"
                    value={categoryColor}
                    onChange={e => setCategoryColor(e.target.value)}
                    className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                    title="Color personalizado"
                  />
                  <div className="ml-auto flex items-center gap-2 px-3 py-1 rounded-full bg-muted/50">
                    <DynamicIcon name={categoryIcon} size={16} color={categoryColor} />
                    <span className="text-xs font-medium" style={{ color: categoryColor }}>
                      {CATEGORY_ICONS.find(i => i.name === categoryIcon)?.label ?? categoryIcon}
                    </span>
                  </div>
                </div>
              </div>
              {categoryError && (
                <p className="text-sm text-destructive">{categoryError}</p>
              )}
            </form>
          )}

          {step === 2 && (
            <form id="onboarding-brand-form" onSubmit={handleCreateBrand} className="space-y-4">
              <p className="text-sm text-subtle">Creá una marca para clasificar mejor tus productos (opcional).</p>
              <div className="space-y-1.5">
                <label className="text-label text-subtle">Nombre</label>
                <Input
                  value={brandName}
                  onChange={e => {
                    setBrandName(e.target.value)
                    setBrandError(null)
                  }}
                  className="h-9 rounded-xl text-sm bg-surface border-edge"
                  placeholder="Ej: Coca-Cola"
                />
              </div>
              {brandError && (
                <p className="text-sm text-destructive">{brandError}</p>
              )}
            </form>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-subtle">Cargá tu primer producto (opcional).</p>
              <NewProductModal
                embedded
                open
                onClose={() => {}}
                businessId={businessId}
                operatorId={operatorId}
                priceLists={priceLists}
                categories={categories}
                brands={brands}
                onCreated={() => {}}
                onSuccess={() => {
                  withStepDone('product')
                  setStep(4)
                }}
              />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-subtle">Invitá a alguien de tu equipo (opcional).</p>
              <NewOperatorModal
                embedded
                open
                onClose={() => {}}
                businessId={businessId}
                operatorId={operatorId}
                onCreated={() => {}}
                onSuccess={() => {
                  withStepDone('operator')
                }}
              />
            </div>
          )}
        </div>

        <div className="border-t border-edge px-4 py-3 shrink-0 bg-surface-alt/30">
          <div className="flex items-center gap-3">
            <div className="w-[140px] shrink-0 text-left">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => void handleDefer()}
                  className="text-xs text-subtle hover:text-body underline-offset-2 hover:underline"
                >
                  Completar después
                </button>
              ) : (
                <span className="inline-block w-1 h-1" aria-hidden />
              )}
            </div>
            <div className="flex-1 flex justify-center items-center gap-1.5">
              {[0, 1, 2, 3, 4].map(i => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    step === i ? 'bg-primary' : 'bg-muted border border-edge'
                  }`}
                />
              ))}
            </div>
            <div className="w-[200px] shrink-0 flex justify-end gap-2 flex-wrap">
              {step === 0 && (
                <Button type="button" className="h-9" onClick={() => void handleStep0Next()}>
                  Siguiente
                </Button>
              )}
              {step === 1 && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 text-xs px-2"
                    onClick={() => {
                      withStepDone('category')
                      setStep(2)
                    }}
                  >
                    Saltar
                  </Button>
                  <Button
                    type="submit"
                    form="onboarding-category-form"
                    disabled={categorySaving}
                    className="h-9"
                  >
                    {categorySaving ? 'Guardando…' : 'Siguiente'}
                  </Button>
                </>
              )}
              {step === 2 && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 text-xs px-2"
                    onClick={() => {
                      withStepDone('brand')
                      setStep(3)
                    }}
                  >
                    Saltar
                  </Button>
                  <Button
                    type="submit"
                    form="onboarding-brand-form"
                    disabled={brandSaving}
                    className="h-9"
                  >
                    {brandSaving ? 'Guardando…' : 'Siguiente'}
                  </Button>
                </>
              )}
              {step === 3 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 text-xs px-2"
                  onClick={() => {
                    withStepDone('product')
                    setStep(4)
                  }}
                >
                  Saltar este paso
                </Button>
              )}
              {step === 4 && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 text-xs px-2"
                    onClick={() => {
                      const nextStepsDone = withStepDone('operator')
                      void handleFinalize(nextStepsDone)
                    }}
                  >
                    Saltar
                  </Button>
                  <Button type="button" className="h-9" onClick={() => {
                    const nextStepsDone = withStepDone('operator')
                    void handleFinalize(nextStepsDone)
                  }}>
                    Finalizar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
