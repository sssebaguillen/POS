import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/shared/AppShell'
import FlashToast from '@/components/shared/FlashToast'
import QueryProvider from '@/providers/query-provider'
import { cookies } from 'next/headers'
import { getActiveOperator } from '@/lib/operator'
import { getBusinessIdByUserId } from '@/lib/business'
import { CURRENCIES } from '@/lib/constants/currencies'
import { CurrencyProvider } from '@/lib/context/CurrencyContext'
import { parseOnboardingState } from '@/components/onboarding/onboarding-types'
import OnboardingTour from '@/components/onboarding/OnboardingTour'

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function computeForeground(hex: string): string {
  return luminance(hex) > 0.45 ? '#0F172A' : '#ffffff'
}

// Returns the best text color for active nav states (primary-colored text on a tinted surface).
// Light mode: primary is displayed on a near-white surface — if primary is too light, fall back to dark.
// Dark mode:  primary is displayed on a near-black surface — if primary is too dark, fall back to light.
function computeActiveText(hex: string): { light: string; dark: string } {
  const L = luminance(hex)
  return {
    light: L > 0.45 ? '#0F172A' : hex,
    dark:  L < 0.12 ? '#ededed' : hex,
  }
}

interface AppLayoutProps {
  children: React.ReactNode
}

export default async function AppLayout({
  children,
}: AppLayoutProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const flashMessage = cookieStore.get('flash_toast')?.value ?? null
  const activeOperator = getActiveOperator(cookieStore)
  const sidebarCollapsed = cookieStore.get('pos-sidebar-collapsed')?.value === 'true'

  let primaryColor = '#7a3e10'
  let businessName = 'Negocio'
  let currencyCode = 'ARS'
  let onboardingProfileId: string | null = null
  let onboardingStateRaw: unknown = null
  let showTour = false
  const businessId = await getBusinessIdByUserId(supabase, user.id)

  if (businessId) {
    const [{ data: business }, { data: profile }] = await Promise.all([
      supabase
        .from('businesses')
        .select('name, settings')
        .eq('id', businessId)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('id, role, onboarding_state')
        .eq('id', user.id)
        .maybeSingle(),
    ])

    if (typeof business?.name === 'string' && business.name.trim().length > 0) {
      businessName = business.name
    }

    const color = business?.settings?.primary_color
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      primaryColor = color
    }

    const settings = business?.settings as Record<string, unknown> | null | undefined
    const rawCurrency = settings?.currency
    if (typeof rawCurrency === 'string' && CURRENCIES.some(c => c.code === rawCurrency)) {
      currencyCode = rawCurrency
    }

    if (profile?.role === 'owner') {
      onboardingProfileId = profile.id
      onboardingStateRaw = profile.onboarding_state
      const onboarding = parseOnboardingState(profile.onboarding_state)
      showTour = !onboarding.completed && !onboarding.tour_done && onboarding.wizard_step >= 5
    }
  }

  return (
    <>
      <style>{`
        :root {
          --primary: ${primaryColor};
          --ring: ${primaryColor};
          --primary-foreground: ${computeForeground(primaryColor)};
          --primary-active-text: ${computeActiveText(primaryColor).light};
        }
        .dark {
          --primary-active-text: ${computeActiveText(primaryColor).dark};
        }
      `}</style>
      <AppShell
        activeOperatorName={activeOperator?.name ?? null}
        activeOperatorRole={activeOperator?.role ?? null}
        businessName={businessName}
        initialCollapsed={sidebarCollapsed}
        showOnboardingResume={(() => {
          if (!onboardingStateRaw) return false
          const s = parseOnboardingState(onboardingStateRaw)
          return !s.completed && s.wizard_suppressed === true
        })()}
      >
        <QueryProvider>
          <CurrencyProvider currency={currencyCode}>
            {children}
          </CurrencyProvider>
        </QueryProvider>
      </AppShell>
      {showTour && onboardingProfileId ? (
        <OnboardingTour
          open={showTour}
          profileId={onboardingProfileId}
          onboardingState={onboardingStateRaw}
        />
      ) : null}
      {flashMessage && <FlashToast message={flashMessage} />}
    </>
  )
}
