'use client'

import { useCallback, useMemo, useState } from 'react'
import type { PriceList } from '@/lib/types'

export interface ProductFormBase {
  name: string
  price: string
  cost: string
  stock: string
  min_stock: string
  sku: string
  brand_id: string
  barcode: string
  category_id: string
  is_active: boolean
}

interface UseProductFormOptions<T extends ProductFormBase> {
  initial: T
  defaultPriceList: PriceList | null
  /** Builder for the price-list IDs set to revert to when price matches the suggested (or on cost change). */
  defaultSelectedListIds: () => Set<string>
  initialSelectedListIds?: Set<string>
  initialIsPriceEdited?: boolean
  /** If true, cost changes preserve a manually-edited price. Default: false (cost always overwrites price). */
  preserveManualPriceOnCostChange?: boolean
  /** If true, stock value is required for non-variant products. Default: false. */
  requireStock?: boolean
}

export interface ProductFormController<T extends ProductFormBase> {
  form: T
  setField: <K extends keyof T>(field: K, value: T[K]) => void
  errors: Record<string, string>
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /** Replay del shake de error en FieldGroup: pasa como `nonce` y bumpea en cada intento fallido. */
  errorNonce: number
  bumpErrorNonce: () => void
  isPriceEdited: boolean
  setIsPriceEdited: (next: boolean) => void
  selectedListIds: Set<string>
  setSelectedListIds: (next: Set<string>) => void
  suggestedPrice: number | null
  margin: number | null
  handleCostChange: (value: string) => void
  handlePriceChange: (value: string) => void
  /** Validates name + (if not skipForVariants) price/cost/stock/min_stock. Returns the errors object (empty if valid). */
  validateBaseFields: (skipForVariants: boolean) => Record<string, string>
  reset: (next?: { initial?: T; selectedListIds?: Set<string>; isPriceEdited?: boolean }) => void
}

export function useProductForm<T extends ProductFormBase>({
  initial,
  defaultPriceList,
  defaultSelectedListIds,
  initialSelectedListIds,
  initialIsPriceEdited = false,
  preserveManualPriceOnCostChange = false,
  requireStock = false,
}: UseProductFormOptions<T>): ProductFormController<T> {
  const [form, setForm] = useState<T>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [errorNonce, setErrorNonce] = useState(0)
  const bumpErrorNonce = useCallback(() => setErrorNonce(n => n + 1), [])
  const [isPriceEdited, setIsPriceEdited] = useState<boolean>(initialIsPriceEdited)
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(
    () => initialSelectedListIds ?? defaultSelectedListIds()
  )

  const suggestedPrice = useMemo(() => {
    if (!defaultPriceList) return null
    const parsedCost = Number(form.cost)
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) return null
    return parsedCost * defaultPriceList.multiplier
  }, [form.cost, defaultPriceList])

  const margin = useMemo(() => {
    const price = Number(form.price)
    const cost = Number(form.cost)
    if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return null
    return Math.round(((price - cost) / price) * 100)
  }, [form.price, form.cost])

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field as string]: '' }))
  }, [])

  function handleCostChange(value: string) {
    setErrors(prev => ({ ...prev, cost: '' }))

    if (!defaultPriceList) {
      setForm(prev => ({ ...prev, cost: value }))
      return
    }

    const parsedCost = Number(value)
    const hasValidCost = !!value.trim() && Number.isFinite(parsedCost) && parsedCost > 0

    if (preserveManualPriceOnCostChange) {
      if (hasValidCost && !isPriceEdited) {
        setForm(prev => ({
          ...prev,
          cost: value,
          price: (parsedCost * defaultPriceList.multiplier).toFixed(2),
        }))
        return
      }
      setForm(prev => ({ ...prev, cost: value }))
      return
    }

    if (!hasValidCost) {
      setForm(prev => ({ ...prev, cost: value, price: '' }))
      setIsPriceEdited(false)
      setSelectedListIds(defaultSelectedListIds())
      return
    }

    setForm(prev => ({ ...prev, cost: value, price: (parsedCost * defaultPriceList.multiplier).toFixed(2) }))
    setIsPriceEdited(false)
    setSelectedListIds(defaultSelectedListIds())
  }

  function handlePriceChange(value: string) {
    setErrors(prev => ({ ...prev, price: '' }))
    setForm(prev => ({ ...prev, price: value }))

    if (suggestedPrice === null) {
      setIsPriceEdited(true)
      setSelectedListIds(defaultSelectedListIds())
      return
    }

    const parsedPrice = Number(value)
    if (!value.trim() || !Number.isFinite(parsedPrice)) {
      setIsPriceEdited(false)
      setSelectedListIds(defaultSelectedListIds())
      return
    }

    const edited = Math.abs(parsedPrice - suggestedPrice) > 0.01
    setIsPriceEdited(edited)
    if (!edited) setSelectedListIds(defaultSelectedListIds())
  }

  function validateBaseFields(skipForVariants: boolean): Record<string, string> {
    const next: Record<string, string> = {}
    if (!form.name.trim()) next.name = 'El nombre es obligatorio'

    if (skipForVariants) return next

    const parsedPrice = Number(form.price)
    if (!form.price || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      next.price = 'Precio inválido'
    }

    if (form.cost) {
      const parsedCost = Number(form.cost)
      if (!Number.isFinite(parsedCost) || parsedCost < 0) next.cost = 'Costo inválido'
    }

    const parsedStock = Number(form.stock)
    if (requireStock) {
      if (!form.stock || !Number.isFinite(parsedStock) || parsedStock < 0) next.stock = 'Stock inválido'
    } else if (form.stock && (!Number.isFinite(parsedStock) || parsedStock < 0)) {
      next.stock = 'Stock inválido'
    }

    if (form.min_stock) {
      const parsedMinStock = Number(form.min_stock)
      if (!Number.isFinite(parsedMinStock) || parsedMinStock < 0) next.min_stock = 'Stock mínimo inválido'
    }

    return next
  }

  function reset(next?: { initial?: T; selectedListIds?: Set<string>; isPriceEdited?: boolean }) {
    setForm(next?.initial ?? initial)
    setErrors({})
    setIsPriceEdited(next?.isPriceEdited ?? initialIsPriceEdited)
    setSelectedListIds(next?.selectedListIds ?? defaultSelectedListIds())
  }

  return {
    form,
    setField,
    errors,
    setErrors,
    errorNonce,
    bumpErrorNonce,
    isPriceEdited,
    setIsPriceEdited,
    selectedListIds,
    setSelectedListIds,
    suggestedPrice,
    margin,
    handleCostChange,
    handlePriceChange,
    validateBaseFields,
    reset,
  }
}
