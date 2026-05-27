import { createClient } from 'jsr:@supabase/supabase-js@2'

interface RefreshDailySnapshotsRequest {
  snapshotDate?: string
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null

  const [scheme, token] = authorizationHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null

  return token
}

function isValidSnapshotDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405)
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    return jsonResponse({ success: false, error: 'Missing CRON_SECRET' }, 500)
  }

  const bearerToken = extractBearerToken(request.headers.get('Authorization'))
  if (bearerToken !== cronSecret) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { success: false, error: 'Missing Supabase service role environment' },
      500
    )
  }

  let snapshotDate: string | undefined

  if (request.headers.get('Content-Length') !== '0') {
    try {
      const body = (await request.json()) as RefreshDailySnapshotsRequest
      snapshotDate = body.snapshotDate?.trim()
    } catch {
      return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400)
    }
  }

  if (snapshotDate && !isValidSnapshotDate(snapshotDate)) {
    return jsonResponse(
      { success: false, error: 'snapshotDate must use YYYY-MM-DD format' },
      400
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { data, error } = await supabase.rpc('refresh_all_daily_snapshots', {
    p_snapshot_date: snapshotDate,
  })

  if (error) {
    return jsonResponse(
      { success: false, error: error.message },
      500
    )
  }

  return jsonResponse({
    success: true,
    snapshotDate: snapshotDate ?? 'default:yesterday',
    data,
  })
})
