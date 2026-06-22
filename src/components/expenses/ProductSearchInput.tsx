'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

export interface ProductResult {
  product_id: string
  product_name: string
  variant_id: string | null
  variant_label: string | null
  stock: number
  cost: number
}

interface Props {
  businessId: string
  supabaseClient: SupabaseClient
  onSelect: (product: ProductResult) => void
  onCreateNew: (initialName: string) => void
  placeholder?: string
}

export default function ProductSearchInput({
  businessId,
  supabaseClient,
  onSelect,
  onCreateNew,
  placeholder = 'Buscar producto por nombre o código de barras...',
}: Props) {
  const formatMoney = useFormatMoney()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(
    async (term: string) => {
      if (!term.trim()) {
        setResults([])
        setOpen(false)
        return
      }
      setLoading(true)
      setError(false)
      const { data, error: rpcError } = await supabaseClient.rpc('search_expense_products', {
        p_business_id: businessId,
        p_term: term,
        p_limit: 20,
      })
      setLoading(false)
      if (rpcError) {
        console.error('search_expense_products failed', rpcError)
        setResults([])
        setError(true)
        setOpen(true)
        return
      }
      setResults((data ?? []) as ProductResult[])
      setOpen(true)
    },
    [supabaseClient, businessId]
  )

  function handleChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setResults([])
      setError(false)
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  function handleSelect(product: ProductResult) {
    onSelect(product)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function handleCreateNew() {
    const name = query.trim()
    setQuery('')
    setResults([])
    setOpen(false)
    onCreateNew(name)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
        <Input
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { if (query.trim() && results.length > 0) setOpen(true) }}
          placeholder={placeholder}
          className="pl-8 h-9 text-sm rounded-lg"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 surface-elevated overflow-hidden animate-in fade-in-0 zoom-in-95 origin-top duration-150">
          {loading && (
            <p className="text-xs text-hint px-3 py-2">Buscando...</p>
          )}

          {!loading && error && (
            <p className="text-sm text-destructive px-3 py-2">No pudimos buscar productos. Intenta de nuevo.</p>
          )}

          {!loading && !error && results.length === 0 && (
            <p className="text-sm text-hint px-3 py-2">Sin resultados</p>
          )}

          {!loading && !error && results.length > 0 && (
            <div className="max-h-56 overflow-y-auto py-1">
              {results.map(product => (
                <button
                  key={product.variant_id ?? product.product_id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); handleSelect(product) }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] text-left gap-3"
                >
                  <span className="text-body font-medium truncate">
                    {product.product_name}
                    {product.variant_label && (
                      <span className="text-hint font-normal"> — {product.variant_label}</span>
                    )}
                  </span>
                  <span className="text-hint text-xs whitespace-nowrap shrink-0">
                    Stock: {product.stock} · {formatMoney(product.cost)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-edge/60">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); handleCreateNew() }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-primary hover:bg-primary/5 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
            >
              <Plus size={14} />
              Crear producto nuevo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
