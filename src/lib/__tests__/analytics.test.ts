import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('posthog-js', () => ({
  default: { identify: vi.fn(), capture: vi.fn(), reset: vi.fn() },
}))

import posthog from 'posthog-js'
import { identifyUser, trackSale, trackOperatorSwitch, resetTracking } from '@/lib/analytics'

const mockedPosthog = vi.mocked(posthog)

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('analytics gating (privacy contract)', () => {
  it('does not emit events when there is no window (server-side)', () => {
    // node env: window is undefined → isEnabled() is false
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'tok'
    trackSale({ total: 100, itemCount: 1, paymentMethods: ['cash'], isMultiPayment: false })
    trackOperatorSwitch()
    identifyUser('u1', 'b1')
    expect(mockedPosthog.capture).not.toHaveBeenCalled()
    expect(mockedPosthog.identify).not.toHaveBeenCalled()
  })

  it('does not emit events when the project token is absent', () => {
    vi.stubGlobal('window', {})
    // no token set
    trackSale({ total: 100, itemCount: 1, paymentMethods: ['cash'], isMultiPayment: false })
    expect(mockedPosthog.capture).not.toHaveBeenCalled()
  })
})

describe('analytics emission (when enabled)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {})
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'tok'
  })

  it('trackSale captures sale_completed with mapped props', () => {
    trackSale({ total: 250, itemCount: 3, paymentMethods: ['cash', 'card'], isMultiPayment: true })
    expect(mockedPosthog.capture).toHaveBeenCalledWith('sale_completed', {
      total: 250,
      item_count: 3,
      payment_methods: ['cash', 'card'],
      is_multi_payment: true,
    })
  })

  it('identifyUser passes the business_id property', () => {
    identifyUser('user-1', 'biz-1')
    expect(mockedPosthog.identify).toHaveBeenCalledWith('user-1', { business_id: 'biz-1' })
  })

  it('trackOperatorSwitch captures operator_session_started', () => {
    trackOperatorSwitch()
    expect(mockedPosthog.capture).toHaveBeenCalledWith('operator_session_started')
  })

  it('resetTracking calls posthog.reset', () => {
    resetTracking()
    expect(mockedPosthog.reset).toHaveBeenCalled()
  })
})
