import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  OWNER_PERMISSIONS,
  type ActiveOperator,
  parseActiveOperator,
  signOperatorSession,
} from '@/lib/operator'
import { getBusinessIdByUserId } from '@/lib/business'

interface OperatorSwitchPayload {
  isOwner: false
  profile_id: string
  pin: string
}

interface OwnerSwitchPayload {
  isOwner: true
  password: string
}

type SwitchPayload = OperatorSwitchPayload | OwnerSwitchPayload

interface OwnerProfile {
  id: string
  name: string
}

function parseSwitchPayload(value: unknown): SwitchPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Record<string, unknown>

  if (payload.isOwner === true) {
    if (typeof payload.password !== 'string') {
      return null
    }

    return {
      isOwner: true,
      password: payload.password,
    }
  }

  if (
    payload.isOwner !== false ||
    typeof payload.profile_id !== 'string' ||
    typeof payload.pin !== 'string'
  ) {
    return null
  }

  return {
    isOwner: false,
    profile_id: payload.profile_id,
    pin: payload.pin,
  }
}

function isOwnerSwitchPayload(payload: SwitchPayload): payload is OwnerSwitchPayload {
  return payload.isOwner === true
}

function isOperatorSwitchPayload(payload: SwitchPayload): payload is OperatorSwitchPayload {
  return payload.isOwner === false
}

// El resultado de verify_operator_pin puede venir como fila única o array; tras
// el unwrap, la validación/normalización de permisos es idéntica a la de la cookie,
// así que se delega en parseActiveOperator (única fuente de verdad, regla #16).
function parseVerifyResult(value: unknown): ActiveOperator | null {
  return parseActiveOperator(Array.isArray(value) ? value[0] : value)
}

export async function POST(request: Request) {
  const body = parseSwitchPayload(await request.json().catch(() => null))

  if (!body) {
    return NextResponse.json({ success: false, error: 'Invalid request payload.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: userError?.message ?? 'Authentication required.' },
      { status: 401 }
    )
  }

  if (isOwnerSwitchPayload(body)) {
    if (!user.email || !body.password) {
      return NextResponse.json({ success: false, error: 'Contraseña incorrecta' }, { status: 401 })
    }

    const { error: ownerSignInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: body.password,
    })

    if (ownerSignInError) {
      return NextResponse.json({ success: false, error: 'Contraseña incorrecta' }, { status: 401 })
    }

    const { data: ownerProfile, error: ownerProfileError } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('id', user.id)
      .single<OwnerProfile>()

    if (ownerProfileError || !ownerProfile) {
      return NextResponse.json(
        { success: false, error: ownerProfileError?.message ?? 'No se pudo obtener el owner actual.' },
        { status: 400 }
      )
    }

    const ownerOperator: ActiveOperator = {
      profile_id: ownerProfile.id,
      name: ownerProfile.name,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    }

    const response = NextResponse.json({ success: true })

    response.cookies.set('operator_session', await signOperatorSession(ownerOperator), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })

    response.cookies.set('op_perms', JSON.stringify(ownerOperator.permissions), {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })

    return response
  }

  if (!isOperatorSwitchPayload(body)) {
    return NextResponse.json({ success: false, error: 'Invalid request payload.' }, { status: 400 })
  }

  const normalizedPin = body.pin.replace(/\D/g, '').slice(0, 4)
  if (normalizedPin.length !== 4) {
    return NextResponse.json({ success: false, error: 'El PIN debe contener exactamente 4 dígitos.' }, { status: 400 })
  }

  let businessId: string | null = null

  try {
    businessId = await getBusinessIdByUserId(supabase, user.id)
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve business_id from profile.',
      },
      { status: 400 }
    )
  }

  if (!businessId) {
    return NextResponse.json(
      { success: false, error: 'Failed to resolve business_id from profile.' },
      { status: 400 }
    )
  }

  const { data: verifyData, error: verifyError } = await supabase.rpc('verify_operator_pin', {
    p_business_id: businessId,
    p_operator_id: body.profile_id,
    p_pin: normalizedPin,
  })

  if (verifyError) {
    return NextResponse.json({ success: false, error: verifyError.message }, { status: 401 })
  }

  const operator = parseVerifyResult(verifyData)

  if (!operator) {
    // verify_operator_pin devuelve { success:false, error, locked? } ante PIN incorrecto o bloqueo.
    const failure = (Array.isArray(verifyData) ? verifyData[0] : verifyData) as
      | Record<string, unknown>
      | null
    const message =
      failure && typeof failure.error === 'string' ? failure.error : 'PIN incorrecto'
    return NextResponse.json({ success: false, error: message }, { status: 401 })
  }

  const response = NextResponse.json({ success: true, name: operator.name, role: operator.role })

  response.cookies.set('operator_session', await signOperatorSession(operator), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })

  response.cookies.set('op_perms', JSON.stringify(operator.permissions), {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })

  return response
}
