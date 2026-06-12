import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeInventoryProduct, fetchInventoryProducts } from '@/lib/inventory-products'

// --- normalizeInventoryProduct (pure) ---

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    business_id: 'biz-1',
    name: 'Producto',
    price: 100,
    cost: 60,
    stock: 10,
    min_stock: 2,
    is_active: true,
    show_in_catalog: true,
    category_id: 'cat-1',
    sku: 'SKU1',
    barcode: null,
    brand_id: 'brand-1',
    image_url: 'https://img/x.png',
    image_source: 'url' as const,
    has_variants: false,
    default_variant_id: null,
    brands: { id: 'brand-1', name: 'Marca' },
    categories: { name: 'Bebidas', icon: '🥤' },
    ...overrides,
  }
}

describe('normalizeInventoryProduct', () => {
  it('uses the product price/cost/stock for non-variant products', () => {
    const result = normalizeInventoryProduct(baseRow() as never)
    expect(result.price).toBe(100)
    expect(result.cost).toBe(60)
    expect(result.stock).toBe(10)
    expect(result.min_stock).toBe(2)
  })

  it('coerces string numerics to numbers', () => {
    const result = normalizeInventoryProduct(
      baseRow({ price: '100', cost: '60', stock: '10', min_stock: '2' }) as never
    )
    expect(result.price).toBe(100)
    expect(result.stock).toBe(10)
  })

  it('treats null numerics as 0', () => {
    const result = normalizeInventoryProduct(
      baseRow({ price: null, cost: null, stock: null, min_stock: null }) as never
    )
    expect(result.price).toBe(0)
    expect(result.stock).toBe(0)
  })

  it('unwraps array-shaped brand and category relations', () => {
    const result = normalizeInventoryProduct(
      baseRow({ brands: [{ id: 'brand-1', name: 'Marca' }], categories: [{ name: 'Bebidas', icon: '🥤' }] }) as never
    )
    expect(result.brand).toEqual({ id: 'brand-1', name: 'Marca' })
    expect(result.categories).toEqual({ name: 'Bebidas', icon: '🥤' })
  })

  it('for variant products, totals stock from the variant stock map', () => {
    const variantTotalStock = new Map([['p-1', 25]])
    const result = normalizeInventoryProduct(
      baseRow({ has_variants: true, stock: 0 }) as never,
      undefined,
      undefined,
      variantTotalStock
    )
    expect(result.stock).toBe(25)
  })

  it('for variant products, uses default-variant price/cost/image when available', () => {
    const defaultVariantMap = new Map([
      ['v-1', { price: 250, cost: 120, stock: 5, image_url: 'https://img/v.png', image_source: 'url' as const }],
    ])
    const result = normalizeInventoryProduct(
      baseRow({ has_variants: true, default_variant_id: 'v-1' }) as never,
      new Map([['p-1', 3]]),
      defaultVariantMap,
      new Map([['p-1', 15]])
    )
    expect(result.price).toBe(250)
    expect(result.cost).toBe(120)
    expect(result.image_url).toBe('https://img/v.png')
    expect(result.stock).toBe(15)
    expect(result.variant_count).toBe(3)
  })

  it('falls back to product image when no default variant image', () => {
    const result = normalizeInventoryProduct(
      baseRow({ has_variants: true, default_variant_id: 'v-1' }) as never,
      undefined,
      new Map(), // no entry for v-1
      undefined
    )
    expect(result.image_url).toBe('https://img/x.png')
    expect(result.stock).toBe(0) // no variant stock map → 0
  })
})

// --- fetchInventoryProducts (mocked Supabase) ---

interface MockConfig {
  products?: { data: unknown[] | null; error: unknown }
  variantCounts?: unknown[]
  defaultVariants?: unknown[]
}

function makeSupabaseMock(config: MockConfig): SupabaseClient {
  return {
    from(table: string) {
      const builder = {
        _table: table,
        _select: '',
        select(s: string) {
          this._select = s
          return this
        },
        eq() {
          return this
        },
        order() {
          return this
        },
        in() {
          return this._resolve()
        },
        range() {
          return this._resolve()
        },
        _resolve() {
          if (this._table === 'products') {
            return Promise.resolve(config.products ?? { data: [], error: null })
          }
          if (this._table === 'product_variants') {
            // The default-variant query selects price/cost/etc.; the count query selects only product_id/stock.
            const data = this._select.includes('price') ? config.defaultVariants ?? [] : config.variantCounts ?? []
            return Promise.resolve({ data, error: null })
          }
          return Promise.resolve({ data: [], error: null })
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe('fetchInventoryProducts', () => {
  it('returns normalized non-variant products', async () => {
    const supabase = makeSupabaseMock({
      products: { data: [baseRow({ id: 'p-1' }), baseRow({ id: 'p-2', name: 'Otro' })], error: null },
    })
    const { data, error } = await fetchInventoryProducts(supabase, 'biz-1')
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data![0].id).toBe('p-1')
    expect(data![0].price).toBe(100)
  })

  it('propagates a query error', async () => {
    const supabase = makeSupabaseMock({
      products: { data: null, error: { message: 'boom', code: 'XX000' } },
    })
    const { data, error } = await fetchInventoryProducts(supabase, 'biz-1')
    expect(data).toBeNull()
    expect(error).toEqual({ message: 'boom', code: 'XX000' })
  })

  it('aggregates variant counts and stock for variant products', async () => {
    const supabase = makeSupabaseMock({
      products: {
        data: [baseRow({ id: 'p-1', has_variants: true, default_variant_id: 'v-1', stock: 0 })],
        error: null,
      },
      variantCounts: [
        { product_id: 'p-1', stock: 4 },
        { product_id: 'p-1', stock: 6 },
      ],
      defaultVariants: [
        { id: 'v-1', price: 300, cost: 150, stock: 4, image_url: null, image_source: null },
      ],
    })
    const { data } = await fetchInventoryProducts(supabase, 'biz-1')
    expect(data![0].variant_count).toBe(2)
    expect(data![0].stock).toBe(10) // 4 + 6
    expect(data![0].price).toBe(300) // from default variant
  })

  it('returns an empty list when there are no products', async () => {
    const supabase = makeSupabaseMock({ products: { data: [], error: null } })
    const { data, error } = await fetchInventoryProducts(supabase, 'biz-1')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
