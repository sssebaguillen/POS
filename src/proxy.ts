import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getActiveOperator, hasPermission } from '@/lib/operator'

const OWNER_PERMISSIONS = {
  sales: true,
  stock: true,
  stats: true,
  settings: true,
} as const

interface AuthProfile {
  id: string
  name: string
  role: string
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

  let operator = getActiveOperator(request.cookies)

  if (!operator) {
    // Allow the operator selection screen to render when session is intentionally cleared.
    if (isOperatorSelectRoute) {
      return supabaseResponse
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', user.id)
      .single<AuthProfile>()

    if (!profileError && profile?.role === 'owner') {
      operator = {
        profile_id: profile.id,
        name: profile.name,
        role: profile.role,
        permissions: {
          ...OWNER_PERMISSIONS,
        },
      }

      supabaseResponse.cookies.set('operator_session', JSON.stringify(operator), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      })
    } else {
      return NextResponse.redirect(new URL('/operator-select', request.url))
    }
  }

  if (isOperatorSelectRoute) {
    return NextResponse.redirect(new URL('/ventas', request.url))
  }

  const isStatsRoute =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/stats' ||
    pathname.startsWith('/stats/')

  if (isStatsRoute && !hasPermission(operator, 'stats')) {
    return NextResponse.redirect(new URL('/ventas', request.url))
  }

  const isStockRoute =
    pathname === '/stock' ||
    pathname.startsWith('/stock/') ||
    pathname === '/inventory' ||
    pathname.startsWith('/inventory/') ||
    pathname === '/products' ||
    pathname.startsWith('/products/') ||
    pathname === '/price-lists' ||
    pathname.startsWith('/price-lists/')

  if (isStockRoute && !hasPermission(operator, 'stock')) {
    return NextResponse.redirect(new URL('/ventas', request.url))
  }

  if (
    (pathname === '/products' || pathname.startsWith('/products/')) &&
    operator.permissions.stock === 'readonly'
  ) {
    return NextResponse.redirect(new URL('/inventory', request.url))
  }

  const isSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/')

  if (isSettingsRoute && !hasPermission(operator, 'settings')) {
    return NextResponse.redirect(new URL('/ventas', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
