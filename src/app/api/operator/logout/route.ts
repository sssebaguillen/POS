import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { OWNER_PERMISSIONS, type ActiveOperator } from '@/lib/operator'

export async function POST() {
  const response = NextResponse.json({ success: true })
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: ownerProfile, error } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('id', user.id)
      .single()

    if (error || !ownerProfile) {
      return NextResponse.json(
        { success: false, error: error?.message ?? 'No se pudo restaurar la sesión del owner.' },
        { status: 400 }
      )
    }

    const ownerOperator: ActiveOperator = {
      profile_id: ownerProfile.id,
      name: ownerProfile.name,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    }

    response.cookies.set('operator_session', JSON.stringify(ownerOperator), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })

    response.cookies.set('op_perms', JSON.stringify(OWNER_PERMISSIONS), {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })

    return response
  }

  response.cookies.set('operator_session', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })

  response.cookies.set('op_perms', '', {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })

  return response
}
