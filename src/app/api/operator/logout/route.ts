import { NextResponse } from 'next/server'

// Clears operator cookies only — does NOT touch the Supabase Auth session.
// The owner must re-authenticate on /operator-select before accessing any route.
// Previously this route restored the owner operator_session automatically, which
// allowed any operator who logged out to bypass /operator-select and access
// owner-only routes (privilege escalation via auto-promotion).
export async function POST() {
  const response = NextResponse.json({ success: true })

  const secure = process.env.NODE_ENV === 'production'

  response.cookies.set('operator_session', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: 0,
  })

  response.cookies.set('op_perms', '', {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: 0,
  })

  return response
}
