import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getActiveOperator, hasPermission, normalizePermissions, OWNER_PERMISSIONS } from '@/lib/operator'

function flashRedirect(destination: URL, csp: string): NextResponse {
  const response = NextResponse.redirect(destination)
  response.cookies.set('flash_toast', 'no-access', {
    maxAge: 5,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  const supabaseWs = supabaseUrl.replace(/^https:\/\//, 'wss://')
  const isDev = process.env.NODE_ENV === 'development'

  // CSP compatible con Next.js App Router.
  // 'unsafe-inline' en script-src es necesario para los inline scripts de
  // hydration que Next.js inyecta en el HTML — no hay forma de evitarlo sin
  // nonce funcionando end-to-end. Las protecciones clave siguen activas:
  // frame-ancestors evita clickjacking, object-src bloquea plugins,
  // base-uri evita base tag injection, form-action limita envío de formularios.
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https: ${supabaseUrl} https://*.supabase.co`,
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://*.supabase.co`,
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ')

  const withCsp = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', cspHeader)

    res.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
    )

    return res
  }

  const requestHeaders = new Headers(request.headers)

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const { pathname } = request.nextUrl

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register')
  const isCatalogRoute = pathname.startsWith('/catalogo')
  const isOperatorSelectRoute = pathname.startsWith('/operator-select')

  if (!user && !isAuthRoute && !isCatalogRoute) {
    return withCsp(NextResponse.redirect(new URL('/login', request.url)))
  }

  if (user && isAuthRoute) {
    return withCsp(NextResponse.redirect(new URL('/pos', request.url)))
  }

  if (!user || isCatalogRoute) {
    return withCsp(supabaseResponse)
  }

  const operator = getActiveOperator(request.cookies)
  const isOwner = operator?.role === 'owner'

  if (isOwner) {
    supabaseResponse.cookies.set('op_perms', JSON.stringify(OWNER_PERMISSIONS), {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
    return withCsp(supabaseResponse)
  }

  if (!operator) {
    // Limpiar cookies stale de operador — pueden quedar con valores inválidos
    // cuando el navegador se cierra sin hacer logout explícito (ej: Safari restore)
    const cookieOptions = { maxAge: 0, path: '/' } as const
    if (isOperatorSelectRoute) {
      supabaseResponse.cookies.set('operator_session', '', cookieOptions)
      supabaseResponse.cookies.set('op_perms', '', cookieOptions)
      return withCsp(supabaseResponse)
    }
    const redirectResponse = NextResponse.redirect(new URL('/operator-select', request.url))
    redirectResponse.cookies.set('operator_session', '', cookieOptions)
    redirectResponse.cookies.set('op_perms', '', cookieOptions)
    return withCsp(redirectResponse)
  }

  if (isOperatorSelectRoute) {
    return withCsp(NextResponse.redirect(new URL('/pos', request.url)))
  }

  const isProfileRoute = pathname === '/profile' || pathname.startsWith('/profile/')
  if (isProfileRoute) {
    return flashRedirect(new URL('/pos', request.url), cspHeader)
  }

  const isExpensesRoute = pathname === '/expenses' || pathname.startsWith('/expenses/')
  if (isExpensesRoute && !hasPermission(operator, 'expenses')) {
    return flashRedirect(new URL('/pos', request.url), cspHeader)
  }

  const isStatsRoute =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/stats' ||
    pathname.startsWith('/stats/')

  if (isStatsRoute && !hasPermission(operator, 'stats')) {
    return flashRedirect(new URL('/pos', request.url), cspHeader)
  }

  const isInventoryRoute =
    pathname === '/inventory' ||
    pathname.startsWith('/inventory/') ||
    pathname === '/products' ||
    pathname.startsWith('/products/')

  if (isInventoryRoute && !hasPermission(operator, 'stock')) {
    return flashRedirect(new URL('/pos', request.url), cspHeader)
  }

  const isPriceListsRoute =
    pathname === '/price-lists' ||
    pathname.startsWith('/price-lists/')

  if (isPriceListsRoute && !hasPermission(operator, 'price_lists')) {
    return flashRedirect(new URL('/pos', request.url), cspHeader)
  }

  if (
    (pathname === '/products' || pathname.startsWith('/products/')) &&
    !hasPermission(operator, 'stock_write')
  ) {
    return withCsp(NextResponse.redirect(new URL('/inventory', request.url)))
  }

  const isSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/')
  if (isSettingsRoute && !hasPermission(operator, 'settings')) {
    return flashRedirect(new URL('/pos', request.url), cspHeader)
  }

  const normalizedPerms = normalizePermissions(operator.permissions)

  supabaseResponse.cookies.set('op_perms', JSON.stringify(normalizedPerms), {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })

  const flashCookie = request.cookies.get('flash_toast')
  if (flashCookie) {
    supabaseResponse.cookies.set('flash_toast', flashCookie.value, {
      maxAge: 5,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    })
  }

  return withCsp(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
