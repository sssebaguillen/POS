// @vitest-environment jsdom
import '@/test/dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CartPanel from '@/components/pos/CartPanel'
import { useCartStore } from '@/lib/store/cart.store'
import { OWNER_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/lib/operator'
import type { Product } from '@/lib/types'
import type { CartItem } from '@/lib/types/cart'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/components/pos/PaymentModal', () => ({ default: () => <div data-testid="payment-modal" /> }))
vi.mock('@/components/pos/SalesHistoryPanel', () => ({ default: () => <div data-testid="history" /> }))

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    business_id: 'biz-1',
    category_id: null,
    brand_id: null,
    name: 'Producto Test',
    sku: null,
    barcode: null,
    price: 100,
    cost: 60,
    stock: 10,
    min_stock: 2,
    image_url: null,
    image_source: null,
    is_active: true,
    show_in_catalog: true,
    sales_count: 0,
    has_variants: false,
    created_at: '2024-01-01',
    ...overrides,
  }
}

function seedCart(item?: Partial<CartItem>) {
  const product = makeProduct()
  const cartItem: CartItem = {
    product,
    free_line_id: null,
    free_line_description: null,
    variant_id: null,
    variant_label: null,
    quantity: 1,
    unit_price: 100,
    total: 100,
    ...item,
  }
  useCartStore.setState({ items: [cartItem], discountMode: 'fixed', discountValue: 0, customerId: null })
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof CartPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const props: React.ComponentProps<typeof CartPanel> = {
    businessId: 'biz-1',
    businessName: 'Shop',
    freeLineEnabled: false,
    activePriceList: null,
    priceListOverrides: [],
    promotions: [],          // required since promos module shipped (2026-06-10)
    operatorId: 'op-1',
    permissions: OWNER_PERMISSIONS,
    ...overrides,
  }
  render(
    <QueryClientProvider client={qc}>
      <CartPanel {...props} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useCartStore.setState({ items: [], discountMode: 'fixed', discountValue: 0, customerId: null })
})

describe('CartPanel — items + quantity', () => {
  it('renders the cart item and its subtotal', () => {
    seedCart()
    renderPanel()
    expect(screen.getByText('Producto Test')).toBeInTheDocument()
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
  })

  it('increments quantity via the + control', async () => {
    const user = userEvent.setup()
    seedCart()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Agregar una unidad' }))
    expect(useCartStore.getState().items[0].quantity).toBe(2)
    expect(useCartStore.getState().subtotal()).toBe(200)
  })
})

describe('CartPanel — discount (gated by pos_pricing)', () => {
  it('hides the discount trigger when pos_pricing is not granted', () => {
    seedCart()
    // pos_pricing controls both price-editing and the discount button
    renderPanel({ permissions: { ...DEFAULT_PERMISSIONS } })
    expect(screen.queryByRole('button', { name: /Desc\./ })).not.toBeInTheDocument()
  })

  it('applies a fixed discount and reflects it in the store and totals', async () => {
    const user = userEvent.setup()
    seedCart()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Desc\./ }))
    await user.type(screen.getByPlaceholderText('0'), '30')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    const state = useCartStore.getState()
    expect(state.discountMode).toBe('fixed')
    expect(state.discountValue).toBe(30)
    expect(state.discountAmount()).toBe(30)
    expect(state.total()).toBe(70)
    expect(screen.getAllByText(/-\$30,00/).length).toBeGreaterThan(0)
  })

  it('applies a percent discount (10% of 100 = 10)', async () => {
    const user = userEvent.setup()
    seedCart()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Desc\./ }))
    await user.click(screen.getByRole('button', { name: '%' }))
    await user.type(screen.getByPlaceholderText('0'), '10')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    const state = useCartStore.getState()
    expect(state.discountMode).toBe('percent')
    expect(state.discountValue).toBe(10)
    expect(state.discountAmount()).toBe(10)
  })

  it('clamps a percent discount above 100 to 100', async () => {
    const user = userEvent.setup()
    seedCart()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Desc\./ }))
    await user.click(screen.getByRole('button', { name: '%' }))
    await user.type(screen.getByPlaceholderText('0'), '150')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(useCartStore.getState().discountValue).toBe(100)
  })
})

describe('CartPanel — price override per line (pos_pricing permission)', () => {
  it('overrides the unit price and marks the line as manual', async () => {
    const user = userEvent.setup()
    seedCart({ quantity: 2, total: 200 })
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Editar precio unitario' }))
    const input = screen.getByDisplayValue('100')
    await user.clear(input)
    await user.type(input, '80')
    await user.keyboard('{Enter}')

    const item = useCartStore.getState().items[0]
    expect(item.unit_price).toBe(80)
    expect(item.priceIsManual).toBe(true)
    expect(item.total).toBe(160) // 80 × 2
  })

  it('does not show the price-edit control without pos_pricing permission', () => {
    seedCart()
    // pos_pricing=false means no price editing or discounting
    renderPanel({ permissions: { ...DEFAULT_PERMISSIONS } })
    expect(screen.queryByRole('button', { name: 'Editar precio unitario' })).not.toBeInTheDocument()
  })
})
