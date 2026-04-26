'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Input } from '@/components/ui/input'

interface ProductResult {
  id: string
  name: string
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
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
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
      const { data } = await supabase
        .from('products')
        .select('id, name, stock, cost')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .or(`name.ilike.%${term}%,barcode.eq.${term}`)
        .order('name')
        .limit(8)
      setLoading(false)
      if (data) {
        setResults(data as ProductResult[])
        setOpen(true)
      }
    },
    [supabase, businessId]
  )

  function handleChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setResults([])
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
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
        <Input
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { if (query.trim() && results.length > 0) setOpen(true) }}
          placeholder={placeholder}
          className="pl-8 h-9 text-sm rounded-lg"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 surface-elevated overflow-hidden">
          {loading && (
            <p className="text-xs text-hint px-3 py-2">Buscando...</p>
          )}

          {!loading && results.length === 0 && (
            <p className="text-sm text-hint px-3 py-2">Sin resultados</p>
          )}

          {!loading && results.length > 0 && (
            <div className="max-h-56 overflow-y-auto py-1">
              {results.map(product => (
                <button
                  key={product.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); handleSelect(product) }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-hover-bg transition-colors text-left gap-3"
                >
                  <span className="text-body font-medium truncate">{product.name}</span>
                  <span className="text-hint text-xs whitespace-nowrap shrink-0">
                    Stock: {product.stock} · ${product.cost.toLocaleString('es-AR')}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-edge/60">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); handleCreateNew() }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-primary hover:bg-primary/5 transition-colors"
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
