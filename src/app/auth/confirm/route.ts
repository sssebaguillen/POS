import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as 'email' | 'recovery' | 'invite' | 'email_change' | null
  console.log('[auth/confirm] searchParams:', { token_hash: token_hash ? `${token_hash.slice(0, 8)}…` : null, type })
  if (!token_hash || !type) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error) {
    console.log('[auth/confirm] verifyOtp error:', { message: error.message, status: error.status })
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url))
  }

  const { error: signOutError } = await supabase.auth.signOut()
  if (signOutError) {
    console.log('[auth/confirm] signOut error:', { message: signOutError.message, status: signOutError.status })
  }

  return NextResponse.redirect(new URL('/email-confirmed', request.url))
}
