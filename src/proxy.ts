import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getActiveOperator, hasPermission, normalizePermissions, OWNER_PERMISSIONS } from '@/lib/operator'

function flashRedirect(destination: URL): NextResponse {
  const response = NextResponse.redirect(destination)
  response.cookies.set('flash_toast', 'no-access', {
    maxAge: 5,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  })
  return response
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseWs = supabaseUrl.replace(/^https:\/\//, 'wss://')
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: ${supabaseUrl}`,
    "font-src 'self'",
    `connect-src 'self' ${supabaseUrl} ${supabaseWs}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  // Forward the nonce to Server Components via request headers.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

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

  if (!user && !isAuthRoute && !isCatalogRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/pos', request.url))
  }

  // Helper: always set CSP right before returning supabaseResponse
  const withCsp = (res: NextResponse) => {
    res.headers.set('Content-Security-Policy', csp)
    return res
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
    return NextResponse.redirect(new URL('/operator-select', request.url))
  }

  if (isOperatorSelectRoute) {
    return NextResponse.redirect(new URL('/pos', request.url))
  }

  const isProfileRoute = pathname === '/profile' || pathname.startsWith('/profile/')
  if (isProfileRoute) {
    return withCsp(supabaseResponse)
  }

  const isGastosRoute = pathname === '/gastos' || pathname.startsWith('/gastos/')
  if (isGastosRoute && !hasPermission(operator, 'expenses')) {
    return flashRedirect(new URL('/pos', request.url))
  }

  const isStatsRoute =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/stats' ||
    pathname.startsWith('/stats/')

  if (isStatsRoute && !hasPermission(operator, 'stats')) {
    return flashRedirect(new URL('/pos', request.url))
  }

  const isStockRoute =
    pathname === '/stock' ||
    pathname.startsWith('/stock/') ||
    pathname === '/inventory' ||
    pathname.startsWith('/inventory/') ||
    pathname === '/products' ||
    pathname.startsWith('/products/')

  if (isStockRoute && !hasPermission(operator, 'stock')) {
    return flashRedirect(new URL('/pos', request.url))
  }

  const isPriceListsRoute =
    pathname === '/price-lists' ||
    pathname.startsWith('/price-lists/')

  if (isPriceListsRoute && !hasPermission(operator, 'price_lists')) {
    return flashRedirect(new URL('/pos', request.url))
  }

  if (
    (pathname === '/products' || pathname.startsWith('/products/')) &&
    !hasPermission(operator, 'stock_write')
  ) {
    return NextResponse.redirect(new URL('/inventory', request.url))
  }

  const isSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/')
  if (isSettingsRoute && !hasPermission(operator, 'settings')) {
    return flashRedirect(new URL('/pos', request.url))
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
