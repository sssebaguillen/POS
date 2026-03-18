import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getActiveOperator, hasPermission, OWNER_PERMISSIONS } from '@/lib/operator'

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
  // Generate a cryptographically random nonce per request.
  // Next.js reads the x-nonce request header and automatically stamps it onto
  // the inline <script> and <style> tags it generates for hydration, so those
  // tags pass the nonce-based CSP without needing 'unsafe-inline'.
  const nonce = btoa(crypto.randomUUID())

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseWs = supabaseUrl.replace(/^https:\/\//, 'wss://')
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    // style-src-attr covers inline style="" attributes used by recharts and
    // other component libraries. This is lower risk than script 'unsafe-inline'.
    "style-src-attr 'unsafe-inline'",
    // next/image serves all images through /_next/image (self).
    // The Supabase host is needed for the raw <img> logo preview in SettingsForm.
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
          // Preserve the nonce headers when Supabase recreates the response.
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

  if (!user || isCatalogRoute) {
    supabaseResponse.headers.set('Content-Security-Policy', csp)
    return supabaseResponse
  }

  const operator = getActiveOperator(request.cookies)

  // Owner identification — only the role: 'owner' cookie value identifies the owner.
  // null (no cookie) means no operator selected yet → send to /operator-select.
  const isOwner = operator?.role === 'owner'

  if (isOwner) {
    supabaseResponse.cookies.set('op_perms', JSON.stringify(OWNER_PERMISSIONS), {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
    supabaseResponse.headers.set('Content-Security-Policy', csp)
    return supabaseResponse
  }

  if (!operator) {
    // No operator session — allow operator-select to render, redirect everything else.
    if (isOperatorSelectRoute) {
      supabaseResponse.headers.set('Content-Security-Policy', csp)
      return supabaseResponse
    }
    return NextResponse.redirect(new URL('/operator-select', request.url))
  }

  // Non-owner operator with active session — redirect away from operator-select
  if (isOperatorSelectRoute) {
    return NextResponse.redirect(new URL('/pos', request.url))
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

  const normalizedPerms = {
    sales:             operator.permissions.sales             ?? false,
    stock:             operator.permissions.stock             ?? false,
    stock_write:       operator.permissions.stock_write       ?? false,
    stats:             operator.permissions.stats             ?? false,
    price_lists:       operator.permissions.price_lists       ?? false,
    price_lists_write: operator.permissions.price_lists_write ?? false,
    settings:          operator.permissions.settings          ?? false,
  }

  supabaseResponse.cookies.set('op_perms', JSON.stringify(normalizedPerms), {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })

  // Forward flash_toast onto supabaseResponse so the Supabase SSR response
  // pipeline does not drop it before the layout reads it server-side.
  const flashCookie = request.cookies.get('flash_toast')
  if (flashCookie) {
    supabaseResponse.cookies.set('flash_toast', flashCookie.value, {
      maxAge: 5,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    })
  }

  supabaseResponse.headers.set('Content-Security-Policy', csp)
  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
