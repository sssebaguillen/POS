'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function confirmEmail(
  token_hash: string,
  type: 'email' | 'recovery' | 'invite' | 'email_change'
): Promise<{ error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash, type })
  if (error) {
    return { error: 'El link de confirmación no es válido o ya expiró.' }
  }
  if (type !== 'recovery') {
    await supabase.auth.signOut()
  }
  redirect('/email-confirmed')
}
