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
  let supabaseResponse = NextResponse.next({ request })
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
          supabaseResponse = NextResponse.next({ request })
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
    return NextResponse.redirect(new URL('/ventas', request.url))
  }

  if (!user || isCatalogRoute) {
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
    return supabaseResponse
  }

  if (!operator) {
    // No operator session — allow operator-select to render, redirect everything else.
    if (isOperatorSelectRoute) {
      return supabaseResponse
    }
    return NextResponse.redirect(new URL('/operator-select', request.url))
  }

  // Non-owner operator with active session — redirect away from operator-select
  if (isOperatorSelectRoute) {
    return NextResponse.redirect(new URL('/ventas', request.url))
  }

  const isStatsRoute =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/stats' ||
    pathname.startsWith('/stats/')

  if (isStatsRoute && !hasPermission(operator, 'stats')) {
    return flashRedirect(new URL('/ventas', request.url))
  }

  const isStockRoute =
    pathname === '/stock' ||
    pathname.startsWith('/stock/') ||
    pathname === '/inventory' ||
    pathname.startsWith('/inventory/') ||
    pathname === '/products' ||
    pathname.startsWith('/products/')

  if (isStockRoute && !hasPermission(operator, 'stock')) {
    return flashRedirect(new URL('/ventas', request.url))
  }

  const isPriceListsRoute =
    pathname === '/price-lists' ||
    pathname.startsWith('/price-lists/')

  if (isPriceListsRoute && !hasPermission(operator, 'price_lists')) {
    return flashRedirect(new URL('/ventas', request.url))
  }

  if (
    (pathname === '/products' || pathname.startsWith('/products/')) &&
    !hasPermission(operator, 'stock_write')
  ) {
    return NextResponse.redirect(new URL('/inventory', request.url))
  }

  const isSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/')

  if (isSettingsRoute && !hasPermission(operator, 'settings')) {
    return flashRedirect(new URL('/ventas', request.url))
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

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
