import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as 'email' | 'recovery' | 'invite' | 'email_change' | null
  const next = searchParams.get('next') ?? '/email-confirmed'

  if (!token_hash || !type) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url))
  }

  return NextResponse.redirect(new URL(next, request.url))
}
