// @vitest-environment jsdom
import '@/test/dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PaymentModal from '@/components/pos/PaymentModal'
import type { ReceiptItemInput, SaleItemInput } from '@/lib/printer/types'
import type { CustomerSelection } from '@/lib/types/pos'

vi.mock('@/lib/api/sales', () => ({ createSaleTransaction: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackSale: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/components/pos/ReceiptPreviewModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="receipt-preview">
      <button onClick={onClose}>close-receipt</button>
    </div>
  ),
}))

import { createSaleTransaction } from '@/lib/api/sales'
import { useCartStore } from '@/lib/store/cart.store'

const mockedCreate = vi.mocked(createSaleTransaction)

const saleItems: SaleItemInput[] = [
  {
    product_id: 'p-1',
    variant_id: null,
    quantity: 1,
    unit_price: 100,
    total: 100,
    unit_price_override: null,
    override_reason: null,
    free_line_description: null,
    promotion_id: null,
    promo_discount: 0,
  },
]

const receiptItems: ReceiptItemInput[] = [
  { ...saleItems[0], name: 'Producto', icon: null, variant_label: null, promo_label: null },
]

function renderModal(overrides: Partial<React.ComponentProps<typeof PaymentModal>> = {}) {
  const onClose = vi.fn()
  const onSaleCompleted = vi.fn()
  const props = {
    businessName: 'Test Shop',
    subtotal: 100,
    discount: 0,
    total: 100,
    businessId: 'biz-1',
    priceListId: null,
    saleItems,
    receiptItems,
    operatorId: 'op-1',
    onClose,
    onSaleCompleted,
    ...overrides,
  }
  render(<PaymentModal {...props} />)
  return { onClose, onSaleCompleted }
}

function confirmButton() {
  return screen.getByRole('button', { name: /Confirmar venta/ })
}

const eligibleCustomer: CustomerSelection = {
  id: 'cust-1',
  name: 'Ana',
  phone: null,
  credit_balance: 0,
  credit_limit: 500,
  is_credit_enabled: true,
}

beforeEach(() => {
  mockedCreate.mockReset()
  useCartStore.setState({ items: [], discountMode: 'fixed', discountValue: 0, customerId: null })
})

describe('PaymentModal — rendering', () => {
  it('shows the title and the default cash UI', () => {
    renderModal()
    expect(screen.getByText('Confirmar pago')).toBeInTheDocument()
    expect(screen.getByText('Monto recibido')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar venta/ })).toBeInTheDocument()
  })

  it('defaults to cash with the confirm button disabled until an amount is entered', () => {
    renderModal()
    expect(confirmButton()).toBeDisabled()
  })
})

describe('PaymentModal — cash flow', () => {
  it('blocks confirmation and shows the shortfall when cash is below the total', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByPlaceholderText('0'), '50')

    expect(screen.getByText(/Falta\s+\$50,00/)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  it('enables confirmation and shows change once cash covers the total', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByPlaceholderText('0'), '120')

    expect(screen.getByText('Vuelto')).toBeInTheDocument()
    expect(screen.getByText('$20,00')).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it('sends a single cash payment with the received amount on confirm', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue({ ok: true, data: { sale_id: 's-1', created_at: '2026-01-01' } })
    const { onSaleCompleted, onClose } = renderModal()

    await user.type(screen.getByPlaceholderText('0'), '100')
    await user.click(confirmButton())

    expect(mockedCreate).toHaveBeenCalledOnce()
    const params = mockedCreate.mock.calls[0][1]
    expect(params.payments).toEqual([{ method: 'cash', amount: 100 }])
    expect(params.total).toBe(100)
    expect(onSaleCompleted).toHaveBeenCalledWith('Venta registrada')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PaymentModal — non-cash flow', () => {
  it('enables confirmation immediately for card and sends the full total', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue({ ok: true, data: { sale_id: 's-1', created_at: '2026-01-01' } })
    const { onSaleCompleted } = renderModal()

    await user.click(screen.getByRole('button', { name: /Tarjeta/ }))
    expect(confirmButton()).toBeEnabled()

    await user.click(confirmButton())
    expect(mockedCreate.mock.calls[0][1].payments).toEqual([{ method: 'card', amount: 100 }])
    expect(onSaleCompleted).toHaveBeenCalled()
  })

  it('surfaces the error and does not complete the sale when the RPC fails', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue({ ok: false, error: 'Sin stock' })
    const { onSaleCompleted } = renderModal()

    await user.click(screen.getByRole('button', { name: /Tarjeta/ }))
    await user.click(confirmButton())

    expect(await screen.findByText('Sin stock')).toBeInTheDocument()
    expect(onSaleCompleted).not.toHaveBeenCalled()
  })
})

describe('PaymentModal — credit (cuenta corriente)', () => {
  it('hides credit when the customer is not credit-enabled', () => {
    renderModal({ customer: null })
    expect(screen.queryByRole('button', { name: /Cuenta corriente/ })).not.toBeInTheDocument()
  })

  it('allows credit within the available limit', async () => {
    const user = userEvent.setup()
    renderModal({ customer: eligibleCustomer })

    await user.click(screen.getByRole('button', { name: /Cuenta corriente/ }))
    expect(screen.getByText('Crédito disponible')).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it('blocks credit when the total exceeds the available limit', async () => {
    const user = userEvent.setup()
    renderModal({ customer: { ...eligibleCustomer, credit_limit: 50 } })

    await user.click(screen.getByRole('button', { name: /Cuenta corriente/ }))
    expect(screen.getByText(/supera el crédito disponible/)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })
})

describe('PaymentModal — mixed payment', () => {
  it('requires both amounts and sends two payments summing to the total', async () => {
    const user = userEvent.setup()
    mockedCreate.mockResolvedValue({ ok: true, data: { sale_id: 's-1', created_at: '2026-01-01' } })
    renderModal()

    await user.click(screen.getByRole('button', { name: /Agregar método/ }))
    expect(screen.getByText('Método 1')).toBeInTheDocument()
    expect(screen.getByText('Método 2')).toBeInTheDocument()

    const amountInputs = screen.getAllByPlaceholderText('0')
    expect(amountInputs).toHaveLength(2)

    // Only the first amount: still short, confirm disabled
    await user.type(amountInputs[0], '60')
    expect(confirmButton()).toBeDisabled()

    await user.type(amountInputs[1], '40')
    expect(confirmButton()).toBeEnabled()

    await user.click(confirmButton())
    const params = mockedCreate.mock.calls[0][1]
    expect(params.payments).toEqual([
      { method: 'cash', amount: 60 },
      { method: 'card', amount: 40 },
    ])
  })

  it('shows the combined shortfall while the mix is below the total', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /Agregar método/ }))
    const amountInputs = screen.getAllByPlaceholderText('0')
    await user.type(amountInputs[0], '30')
    await user.type(amountInputs[1], '20')

    // 30 + 20 = 50 of 100 → combined shortfall of $50,00
    expect(screen.getByText('Total recibido')).toBeInTheDocument()
    expect(screen.getByText(/Falta\s+\$50,00/)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })
})
