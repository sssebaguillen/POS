import { createClient } from '@/lib/supabase/server'

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export interface AuthenticatedBusinessContext {
  userId: string
  businessId: string
}

export async function getBusinessIdByUserId(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('business_id')
    .eq('id', userId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return profile?.business_id ?? null
}

export async function requireAuthenticatedBusinessContext(
  supabase: ServerSupabaseClient
): Promise<AuthenticatedBusinessContext> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error(userError?.message ?? 'No authenticated user found.')
  }

  const businessId = await getBusinessIdByUserId(supabase, user.id)

  if (!businessId) {
    throw new Error('No se encontro business_id en el perfil del usuario autenticado')
  }

  return {
    userId: user.id,
    businessId,
  }
}

export async function requireAuthenticatedBusinessId(
  supabase: ServerSupabaseClient
): Promise<string> {
  const context = await requireAuthenticatedBusinessContext(supabase)
  return context.businessId
}
