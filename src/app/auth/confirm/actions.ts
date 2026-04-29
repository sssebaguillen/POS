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
    console.log('[auth/confirm] verifyOtp error:', { message: error.message, status: error.status })
    return { error: 'El link de confirmación no es válido o ya expiró.' }
  }
  const { error: signOutError } = await supabase.auth.signOut()
  if (signOutError) {
    console.log('[auth/confirm] signOut error:', { message: signOutError.message, status: signOutError.status })
  }
  redirect('/email-confirmed')
}
