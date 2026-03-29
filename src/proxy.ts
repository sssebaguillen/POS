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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseWs = supabaseUrl.replace(/^https:\/\//, 'wss://')

  // 🔥 NUEVO: Generamos nonce único por request
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'

  // CSP PROFESIONAL con nonce + strict-dynamic
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",           // necesario para Next.js
    `img-src 'self' data: blob: ${supabaseUrl}`,
    "font-src 'self'",
    `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://*.supabase.co`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ')

  const withCsp = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', cspHeader)
    res.headers.set('x-nonce', nonce)                    // ← importante para leer después
    return res
  }

  const requestHeaders = new Headers(request.headers)

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const { pathname } = request.nextUrl

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // 🔥 FIX: todos los redirects con CSP + nonce
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
    if (isOperatorSelectRoute) {
      return withCsp(supabaseResponse)
    }
    return withCsp(NextResponse.redirect(new URL('/operator-select', request.url)))
  }

  if (isOperatorSelectRoute) {
    return withCsp(NextResponse.redirect(new URL('/pos', request.url)))
  }

  const isProfileRoute = pathname === '/profile' || pathname.startsWith('/profile/')
  if (isProfileRoute) {
    return withCsp(supabaseResponse)
  }

  const isGastosRoute = pathname === '/gastos' || pathname.startsWith('/gastos/')
  if (isGastosRoute && !hasPermission(operator, 'expenses')) {
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

  const isStockRoute =
    pathname === '/stock' ||
    pathname.startsWith('/stock/') ||
    pathname === '/inventory' ||
    pathname.startsWith('/inventory/') ||
    pathname === '/products' ||
    pathname.startsWith('/products/')

  if (isStockRoute && !hasPermission(operator, 'stock')) {
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